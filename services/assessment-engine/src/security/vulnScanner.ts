import * as https from 'node:https';
import * as http from 'node:http';
import type { ApiEndpoint } from './apiExtractor.js';

export type VulnSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface VulnFinding {
  url: string;
  method: string;
  type: string;
  severity: VulnSeverity;
  description: string;
  evidence: string;
  payload?: string;
}

export interface ScanResult {
  findings: VulnFindings;
  scannedEndpoints: number;
  duration: number;
}

export interface VulnFindings {
  sqli: VulnFinding[];
  xss: VulnFinding[];
  idor: VulnFinding[];
  pathTraversal: VulnFinding[];
  openRedirect: VulnFinding[];
  infoDisclosure: VulnFinding[];
}

// ── Payloads ──────────────────────────────────────────────────────────────────
// Detection-only payloads. We deliberately DO NOT include destructive
// statements (e.g. DROP TABLE): a single quote already triggers error-based
// detection, and a sleep already triggers time-based detection — there is no
// reason to risk data loss on the target to identify the same vulnerability.
const SQLI_PAYLOADS = [
  "'",
  "''",
  "' OR '1'='1",
  // Time-based blind: use sleep to detect when error messages are suppressed
  "1' AND SLEEP(3)--",
  "1' WAITFOR DELAY '0:0:3'--",
];

const XSS_PAYLOADS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  // Attribute context: closes attribute + injects event handler
  "' onmouseover='alert(1)",
  // JavaScript URL context
  'javascript:alert(1)',
];

const PATH_TRAVERSAL_PAYLOADS = [
  '../../../etc/passwd',
  '..\\..\\..\\windows\\win.ini',
  '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
  '....//....//etc/passwd', // filter bypass
];

const OPEN_REDIRECT_PAYLOADS = ['https://evil.com', '//evil.com', '/\\evil.com'];

// ── Error patterns: only reliable database error strings ─────────────────────
// NOTE: Generic "syntax error" is removed — too many false positives on non-SQL pages.
const SQLI_ERROR_PATTERNS = [
  /You have an error in your SQL syntax/i,
  /mysql_fetch_array\(\)/i,
  /ORA-\d{5}:/i,
  /PostgreSQL.*ERROR.*syntax/is,
  /SQLite.*Exception/i,
  /Unclosed quotation mark after the character string/i,
  /SQLSTATE\[/i,
  /javax\.persistence\.PersistenceException/i,
  /org\.hibernate\.exception/i,
];

const PATH_TRAVERSAL_MARKERS = [
  'root:x:0:0',        // /etc/passwd — specific format, not just "root"
  '[boot loader]',     // windows\win.ini
  'bin/bash',
];

// ── XSS: check if payload is reflected in an exploitable HTML context ─────────
// Returns the context type if exploitable, null if reflected safely (encoded) or not at all.
// Exported for unit testing — this is the trickiest false-positive logic in the scanner.
export function detectXssContext(body: string, payload: string): string | null {
  if (!body.includes(payload)) return null; // not reflected at all

  const payloadIndex = body.indexOf(payload);

  // Check if the reflection is inside an HTML comment — not exploitable
  if (/<!--[\s\S]*$/.test(body.slice(0, payloadIndex)) &&
      /^[\s\S]*-->/.test(body.slice(payloadIndex))) {
    return null; // inside HTML comment
  }

  // Check if it's inside a <script> block — exploitable
  const beforePayload = body.slice(0, payloadIndex);
  const lastScriptOpen  = beforePayload.lastIndexOf('<script');
  const lastScriptClose = beforePayload.lastIndexOf('</script');
  if (lastScriptOpen > lastScriptClose) return 'script-context';

  // Check if the raw <script> tag or onerror is present (unencoded)
  if (/<script\s*>/i.test(payload) && body.includes(payload)) return 'html-injection';
  if (/onerror=/i.test(payload) && body.includes(payload)) return 'attribute-injection';

  return null;
}

function makeRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
): Promise<{ status: number; body: string; headers: Record<string, string>; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const start = Date.now();
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: { 'User-Agent': 'Mozilla/5.0 (Security Scanner)', ...headers },
      // The scanner intentionally accepts invalid/self-signed certs so it can
      // probe misconfigured targets (that's part of what it's testing). Note:
      // this means the scanner's own probes are not protected against MITM.
      rejectUnauthorized: false,
      timeout: 10000,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => {
        data += chunk;
        if (data.length > 100000) data = data.slice(0, 100000);
      });
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: data,
        headers: Object.fromEntries(
          Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v ?? ''])
        ),
        durationMs: Date.now() - start,
      }));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// ── Get a baseline response to compare against (reduces false positives) ──────
async function getBaseline(
  endpoint: ApiEndpoint,
  param: string,
): Promise<{ body: string; status: number; durationMs: number } | null> {
  try {
    if (endpoint.isFormEndpoint && endpoint.method === 'POST') {
      // POST form baseline: submit all fields with benign values
      const fields = endpoint.queryParams.map((p) => `${encodeURIComponent(p)}=${encodeURIComponent('baseline_9421')}`).join('&');
      const resp = await makeRequest(endpoint.url, 'POST', {
        'Content-Type': 'application/x-www-form-urlencoded',
      }, fields);
      return { body: resp.body, status: resp.status, durationMs: resp.durationMs };
    }
    const testUrl = new URL(endpoint.url);
    testUrl.searchParams.set(param, 'baseline_value_9421');
    const resp = await makeRequest(testUrl.toString(), endpoint.method, {});
    return { body: resp.body, status: resp.status, durationMs: resp.durationMs };
  } catch {
    return null;
  }
}

/** Build a test request URL or body with one parameter set to the payload. */
function buildTestRequest(
  endpoint: ApiEndpoint,
  param: string,
  payload: string,
): { url: string; method: string; headers: Record<string, string>; body?: string } {
  if (endpoint.isFormEndpoint && endpoint.method === 'POST') {
    // Submit all other fields with benign values, inject payload into target param
    const fields = endpoint.queryParams
      .map((p) => `${encodeURIComponent(p)}=${encodeURIComponent(p === param ? payload : 'test')}`)
      .join('&');
    return {
      url: endpoint.url,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: fields,
    };
  }
  const testUrl = new URL(endpoint.url);
  testUrl.searchParams.set(param, payload);
  return { url: testUrl.toString(), method: endpoint.method, headers: {} };
}

async function testSqli(endpoint: ApiEndpoint): Promise<VulnFinding[]> {
  const findings: VulnFinding[] = [];

  for (const param of endpoint.queryParams) {
    const baseline = await getBaseline(endpoint, param);
    if (!baseline) continue;

    for (const payload of SQLI_PAYLOADS) {
      try {
        const req = buildTestRequest(endpoint, param, payload);
        const resp = await makeRequest(req.url, req.method, req.headers, req.body);

        const hasDbError = SQLI_ERROR_PATTERNS.some(p => p.test(resp.body));
        const isTimeBased = payload.includes('SLEEP') || payload.includes('WAITFOR');
        const isSignificantlySlower = resp.durationMs > baseline.durationMs + 2500;

        if (hasDbError) {
          findings.push({
            url: endpoint.url, method: endpoint.method,
            type: 'SQL Injection (Error-based)', severity: 'critical',
            description: `SQL error in response for ${endpoint.isFormEndpoint ? 'form field' : 'parameter'} "${param}"`,
            evidence: resp.body.slice(0, 300),
            payload: `${param}=${payload}`,
          });
          break;
        }

        if (isTimeBased && isSignificantlySlower) {
          findings.push({
            url: endpoint.url, method: endpoint.method,
            type: 'SQL Injection (Time-based Blind)', severity: 'critical',
            description: `Response delayed ${resp.durationMs}ms vs baseline ${baseline.durationMs}ms with sleep payload on "${param}"`,
            evidence: `Baseline: ${baseline.durationMs}ms, With payload: ${resp.durationMs}ms`,
            payload: `${param}=${payload}`,
          });
          break;
        }
      } catch { /* skip on network error */ }
    }
  }
  return findings;
}

async function testXss(endpoint: ApiEndpoint): Promise<VulnFinding[]> {
  const findings: VulnFinding[] = [];

  for (const param of endpoint.queryParams) {
    for (const payload of XSS_PAYLOADS) {
      try {
        const req = buildTestRequest(endpoint, param, payload);
        const resp = await makeRequest(req.url, req.method, req.headers, req.body);

        const context = detectXssContext(resp.body, payload);
        if (context) {
          findings.push({
            url: endpoint.url, method: endpoint.method,
            type: 'Reflected XSS', severity: 'high',
            description: `XSS payload reflected unencoded in ${context} for ${endpoint.isFormEndpoint ? 'form field' : 'parameter'} "${param}"`,
            evidence: `Payload "${payload}" found in ${context} context`,
            payload: `${param}=${payload}`,
          });
          break;
        }
      } catch { /* skip */ }
    }
  }
  return findings;
}

async function testPathTraversal(endpoint: ApiEndpoint): Promise<VulnFinding[]> {
  const findings: VulnFinding[] = [];

  // Only test parameters that look like they accept file paths
  const fileParams = endpoint.queryParams.filter(p =>
    /file|path|page|doc|template|view|load|include|dir|folder/i.test(p)
  );

  for (const param of fileParams) {
    for (const payload of PATH_TRAVERSAL_PAYLOADS) {
      try {
        const testUrl = new URL(endpoint.url);
        testUrl.searchParams.set(param, payload);
        const resp = await makeRequest(testUrl.toString(), 'GET', {});
        const vulnerable = PATH_TRAVERSAL_MARKERS.some(m => resp.body.includes(m));
        if (vulnerable) {
          findings.push({
            url: endpoint.url, method: endpoint.method,
            type: 'Path Traversal', severity: 'critical',
            description: `Path traversal in parameter "${param}" — sensitive file content returned`,
            evidence: resp.body.slice(0, 200),
            payload: `${param}=${payload}`,
          });
          break;
        }
      } catch { /* skip */ }
    }
  }
  return findings;
}

async function testOpenRedirect(endpoint: ApiEndpoint): Promise<VulnFinding[]> {
  const findings: VulnFinding[] = [];
  const redirectParams = endpoint.queryParams.filter(p =>
    /redirect|return|next|url|goto|dest|destination|redir|callback/i.test(p)
  );

  for (const param of redirectParams) {
    for (const payload of OPEN_REDIRECT_PAYLOADS) {
      try {
        const testUrl = new URL(endpoint.url);
        testUrl.searchParams.set(param, payload);
        const resp = await makeRequest(testUrl.toString(), 'GET', {});
        const location = resp.headers['location'] ?? '';
        if ((resp.status >= 300 && resp.status < 400) && location.includes('evil.com')) {
          findings.push({
            url: endpoint.url, method: endpoint.method,
            type: 'Open Redirect', severity: 'medium',
            description: `Open redirect via parameter "${param}" — redirects to attacker-controlled URL`,
            evidence: `Redirects to: ${location}`,
            payload: `${param}=${payload}`,
          });
          break;
        }
      } catch { /* skip */ }
    }
  }
  return findings;
}

async function testInfoDisclosure(endpoint: ApiEndpoint): Promise<VulnFinding[]> {
  const findings: VulnFinding[] = [];
  const sensitivePatterns = [
    // Stack traces — specific enough to avoid FP on normal JS minified code
    { pattern: /at \w+\.\w+\s*\([\w/.]+:\d+:\d+\)/m, type: 'Stack Trace Exposure', severity: 'medium' as VulnSeverity,
      note: 'Server-side stack trace exposed in response' },
    { pattern: /Exception in thread "main"/i, type: 'Java Exception', severity: 'medium' as VulnSeverity,
      note: 'Java exception in response' },
    { pattern: /Warning: .+ in \/.+ on line \d+/i, type: 'PHP Error', severity: 'medium' as VulnSeverity,
      note: 'PHP error message with file path and line number exposed' },
    { pattern: /SQLSTATE\[/i, type: 'Database Error', severity: 'high' as VulnSeverity,
      note: 'SQL state error code — confirms database type and error details' },
    // Credential patterns in response bodies (not headers — those are handled by apiExtractor)
    { pattern: /"password"\s*:\s*"[^"]{4,}"/i, type: 'Password in Response', severity: 'critical' as VulnSeverity,
      note: 'Password field with non-empty value in JSON response' },
    { pattern: /"(secret|private_key|privateKey|client_secret)"\s*:\s*"[^"]{8,}"/i,
      type: 'Secret in Response', severity: 'high' as VulnSeverity,
      note: 'Secret/private key field in JSON response' },
    { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, type: 'Private Key in Response',
      severity: 'critical' as VulnSeverity, note: 'Private key material in response body' },
  ];

  try {
    const resp = await makeRequest(endpoint.url, endpoint.method, {});

    // Skip if response is obviously JavaScript/CSS (would false-positive on minified code)
    const contentType = resp.headers['content-type'] ?? '';
    if (/javascript|css|font|image/i.test(contentType)) return findings;

    for (const { pattern, type, severity, note } of sensitivePatterns) {
      if (pattern.test(resp.body)) {
        findings.push({
          url: endpoint.url, method: endpoint.method,
          type: `Information Disclosure: ${type}`, severity,
          description: note,
          evidence: resp.body.slice(0, 300),
        });
      }
    }
  } catch { /* skip */ }

  return findings;
}

/**
 * IDOR probe: for endpoints whose path contains numeric IDs, request the
 * adjacent ID and flag it if the server returns data without an authorization
 * check. Only runs on JSON endpoints.
 *
 * NOTE: This deliberately does NOT fuzz request-body parameters. Body-param
 * injection is not implemented — see the roadmap in SECURITY.md.
 */
async function testIdorOnPathIds(endpoint: ApiEndpoint): Promise<VulnFinding[]> {
  const findings: VulnFinding[] = [];

  // Only test JSON endpoints
  if (!endpoint.requestContentType?.includes('application/json')) return findings;

  // Attempt to inject into path segments that look like IDs (IDOR check)
  const pathParts = endpoint.path.split('/').filter(Boolean);
  const numericParts = pathParts.filter(p => /^\d+$/.test(p));

  for (const id of numericParts) {
    // IDOR: try adjacent IDs
    const adjacentId = String(parseInt(id, 10) + 1);
    const testUrl = endpoint.url.replace(`/${id}`, `/${adjacentId}`);
    try {
      const resp = await makeRequest(testUrl, endpoint.method, {});
      // If the adjacent ID returns 200 with a body, flag as potential IDOR
      if (resp.status === 200 && resp.body.length > 50) {
        findings.push({
          url: endpoint.url, method: endpoint.method,
          type: 'Potential IDOR', severity: 'medium',
          description: `Path ID ${id} → ${adjacentId} returns 200 — verify authorization check`,
          evidence: `${testUrl} returned ${resp.status} (${resp.body.length} bytes)`,
          payload: adjacentId,
        });
      }
    } catch { /* skip */ }
  }

  return findings;
}

export async function runVulnScan(endpoints: ApiEndpoint[]): Promise<ScanResult> {
  const start = Date.now();
  const findings: VulnFindings = {
    sqli: [], xss: [], idor: [], pathTraversal: [], openRedirect: [], infoDisclosure: [],
  };

  // Test ALL endpoints with query params (not just first 10)
  // For query-param tests cap at 20 to avoid excessive scanning
  const queryParamTargets = endpoints.filter(e => e.queryParams.length > 0).slice(0, 20);

  // Test all endpoints for info disclosure and IDOR (these don't brute-force)
  const allTargets = endpoints.slice(0, 30);

  await Promise.all([
    // Query-param injection tests
    ...queryParamTargets.map(async (endpoint) => {
      const [sqli, xss, pathTraversal, openRedirect] = await Promise.all([
        testSqli(endpoint),
        testXss(endpoint),
        testPathTraversal(endpoint),
        testOpenRedirect(endpoint),
      ]);
      findings.sqli.push(...sqli);
      findings.xss.push(...xss);
      findings.pathTraversal.push(...pathTraversal);
      findings.openRedirect.push(...openRedirect);
    }),

    // Info disclosure and IDOR for all endpoints
    ...allTargets.map(async (endpoint) => {
      const [infoDisclosure, idor] = await Promise.all([
        testInfoDisclosure(endpoint),
        testIdorOnPathIds(endpoint),
      ]);
      findings.infoDisclosure.push(...infoDisclosure);
      findings.idor.push(...idor);
    }),
  ]);

  // ── Global deduplication ──────────────────────────────────────────────────
  // Strip framework-specific tokens (_rsc, __cf_chl, etc.) before deduping
  // so the same vulnerability on the same page isn't reported 10+ times
  // just because each visit had a different cache-busting token.
  function dedupeFindings(arr: VulnFinding[]): VulnFinding[] {
    const seen = new Set<string>();
    return arr.filter(f => {
      // Normalise URL: remove _rsc, __cf_, _next_router, and other framework tokens
      let normUrl = f.url;
      try {
        const u = new URL(f.url);
        const stripped = new URLSearchParams();
        for (const [k, v] of u.searchParams) {
          if (/^_rsc$|^__cf|^_next|^__next|^rsc$|^ts$|^cb$|^_t$|^_v$/i.test(k)) continue;
          stripped.set(k, v);
        }
        u.search = stripped.toString();
        normUrl = u.href;
      } catch { /* keep original */ }
      const key = `${f.type}:${normUrl}:${f.payload ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  findings.xss          = dedupeFindings(findings.xss);
  findings.sqli         = dedupeFindings(findings.sqli);
  findings.pathTraversal = dedupeFindings(findings.pathTraversal);
  findings.openRedirect  = dedupeFindings(findings.openRedirect);
  findings.infoDisclosure = dedupeFindings(findings.infoDisclosure);
  findings.idor          = dedupeFindings(findings.idor);

  return {
    findings,
    scannedEndpoints: new Set([...queryParamTargets, ...allTargets].map(e => e.url)).size,
    duration: Date.now() - start,
  };
}

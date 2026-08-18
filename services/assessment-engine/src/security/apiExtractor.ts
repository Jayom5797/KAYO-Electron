import type { NetworkRequest, DiscoveredForm } from '../types.js';

export interface JwtClaims {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  raw: string;
}

export interface ApiEndpoint {
  url: string;
  method: string;
  baseUrl: string;
  path: string;
  queryParams: string[];
  requestContentType: string | null;
  responseContentType: string | null;
  statusCode: number | null;
  durationMs: number;
  hasAuth: boolean;
  authType: string | null;
  jwts: JwtClaims[];
  sensitiveLeaks: SensitiveLeak[];
  /** True when synthesised from an HTML form rather than observed network traffic. */
  isFormEndpoint?: boolean;
}

export interface SensitiveLeak {
  location: 'url' | 'request-header' | 'response-header' | 'response-body';
  type: string;
  value: string;
  /** Why this is a real leak, not expected behavior */
  reason: string;
}

const JWT_REGEX = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;

// ─── Patterns that are ONLY leaks in specific locations ─────────────────────
// Rule: Bearer/Basic tokens are EXPECTED in request Authorization headers.
//       They are leaks only if they appear in URLs or response bodies.
// Rule: Email addresses are only a leak if in a URL query param.
// Rule: API keys are leaks everywhere except the Authorization/X-Api-Key header.

interface SensitivePattern {
  type: string;
  pattern: RegExp;
  /** Locations where this pattern is an actual leak */
  leakLocations: Array<SensitiveLeak['location']>;
  reason: string;
}

const SENSITIVE_PATTERNS: SensitivePattern[] = [
  {
    type: 'API Key (generic)',
    pattern: /(?:api[_-]?key|apikey)[=:\s]["']?([A-Za-z0-9_-]{16,})/i,
    leakLocations: ['url', 'response-header', 'response-body'],
    reason: 'API key exposed outside of Authorization header — may be logged or cached',
  },
  {
    type: 'AWS Access Key',
    pattern: /AKIA[0-9A-Z]{16}/,
    leakLocations: ['url', 'request-header', 'response-header', 'response-body'],
    reason: 'AWS Access Key ID found — credential exposure risk',
  },
  {
    type: 'Bearer Token in URL',
    pattern: /[?&](access_token|token|bearer)[=]([A-Za-z0-9\-._~+/]+=*)/i,
    leakLocations: ['url'],
    reason: 'Auth token in URL will appear in server logs, browser history, and Referer headers',
  },
  {
    type: 'Bearer Token in Response',
    pattern: /Bearer\s+([A-Za-z0-9\-._~+/]+=*)/i,
    leakLocations: ['response-header', 'response-body'],
    reason: 'Auth token reflected in response — may indicate token mis-routing',
  },
  {
    type: 'Basic Auth Credentials in URL',
    pattern: /https?:\/\/[^:@/\s]+:[^@/\s]+@/i,
    leakLocations: ['url'],
    reason: 'Credentials embedded in URL — logged in plaintext by proxies and servers',
  },
  {
    type: 'GitHub Token',
    pattern: /ghp_[A-Za-z0-9]{36}/,
    leakLocations: ['url', 'request-header', 'response-header', 'response-body'],
    reason: 'GitHub personal access token — full repository access',
  },
  {
    type: 'Slack Token',
    pattern: /xox[baprs]-[A-Za-z0-9-]+/,
    leakLocations: ['url', 'request-header', 'response-header', 'response-body'],
    reason: 'Slack API token exposed',
  },
  {
    type: 'Private Key',
    pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
    leakLocations: ['url', 'request-header', 'response-header', 'response-body'],
    reason: 'Private key material in transit — critical exposure',
  },
  {
    type: 'Password in URL',
    pattern: /[?&](?:password|passwd|pwd)=([^&\s]+)/i,
    leakLocations: ['url'],
    reason: 'Password in URL query param — logged in plaintext by every proxy and web server',
  },
  {
    type: 'Email in URL',
    pattern: /[?&](?:email|mail|user)=([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
    leakLocations: ['url'],
    reason: 'Email address in URL query param — logged by servers, leaks via Referer header',
  },
];

function decodeJwt(token: string): JwtClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const decode = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    return { header: decode(parts[0]), payload: decode(parts[1]), raw: token };
  } catch {
    return null;
  }
}

function scanForSensitive(
  text: string,
  location: SensitiveLeak['location'],
): SensitiveLeak[] {
  const leaks: SensitiveLeak[] = [];
  for (const { type, pattern, leakLocations, reason } of SENSITIVE_PATTERNS) {
    if (!leakLocations.includes(location)) continue; // skip if not a leak in this location
    const match = text.match(pattern);
    if (match) {
      leaks.push({ location, type, value: match[0].slice(0, 80), reason });
    }
  }
  return leaks;
}

function scanForJwts(text: string): JwtClaims[] {
  const matches = text.match(JWT_REGEX) ?? [];
  return matches.map(decodeJwt).filter((j): j is JwtClaims => j !== null);
}

export function extractApiEndpoints(requests: NetworkRequest[]): ApiEndpoint[] {
  const apiRequests = requests.filter(
    r => r.resourceType === 'xhr' || r.resourceType === 'fetch' ||
         r.method === 'POST' || r.method === 'PUT' ||
         r.method === 'DELETE' || r.method === 'PATCH'
  );

  return apiRequests.map(req => {
    let parsed: URL;
    try { parsed = new URL(req.url); } catch { parsed = new URL('https://unknown'); }

    const queryParams = Array.from(parsed.searchParams.keys());
    const reqHeaders = Object.fromEntries(
      Object.entries(req.requestHeaders).map(([k, v]) => [k.toLowerCase(), v])
    );
    const respHeaders = Object.fromEntries(
      Object.entries(req.responseHeaders).map(([k, v]) => [k.toLowerCase(), v])
    );

    const authHeader = reqHeaders['authorization'] ?? '';
    const hasAuth = !!authHeader || !!reqHeaders['x-api-key'] || !!reqHeaders['x-auth-token'];
    let authType: string | null = null;
    if (authHeader.startsWith('Bearer ')) authType = 'Bearer Token';
    else if (authHeader.startsWith('Basic ')) authType = 'Basic Auth';
    else if (reqHeaders['x-api-key']) authType = 'API Key Header';
    else if (reqHeaders['x-auth-token']) authType = 'X-Auth-Token';

    // JWT scan: response headers and URL only (request Authorization header is expected)
    const respHeaderText = Object.values(req.responseHeaders).join(' ');
    const jwts = scanForJwts(respHeaderText + ' ' + req.url);

    // Build response header text without the Authorization header (that's expected)
    const respHeadersForScan = Object.entries(req.responseHeaders)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    // Request headers: only scan non-auth headers for leaks
    // (Authorization, X-Api-Key, X-Auth-Token in request headers = correct, not leaks)
    const reqHeadersForScan = Object.entries(req.requestHeaders)
      .filter(([k]) => !['authorization', 'x-api-key', 'x-auth-token'].includes(k.toLowerCase()))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const sensitiveLeaks: SensitiveLeak[] = [
      ...scanForSensitive(req.url, 'url'),
      ...scanForSensitive(reqHeadersForScan, 'request-header'),
      ...scanForSensitive(respHeadersForScan, 'response-header'),
    ];

    // Deduplicate by type+location
    const seen = new Set<string>();
    const uniqueLeaks = sensitiveLeaks.filter(l => {
      const key = `${l.type}:${l.location}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      url: req.url,
      method: req.method,
      baseUrl: `${parsed.protocol}//${parsed.host}`,
      path: parsed.pathname,
      queryParams,
      requestContentType: reqHeaders['content-type'] ?? null,
      responseContentType: respHeaders['content-type'] ?? null,
      statusCode: req.statusCode,
      durationMs: req.durationMs,
      hasAuth,
      authType,
      jwts,
      sensitiveLeaks: uniqueLeaks,
    };
  });
}

/**
 * Convert discovered HTML forms into ApiEndpoint objects so the active vuln
 * scanner can probe their fields for SQLi, XSS, open redirect, etc.
 *
 * A form field becomes a queryParam key regardless of whether the form uses
 * GET or POST — the vuln scanner tests query params for GET and synthesises
 * POST bodies for POST endpoints.
 *
 * Password fields are included intentionally: we want to test for SQLi/XSS
 * in auth endpoints, which is exactly where they're most dangerous.
 */
export function formsToApiEndpoints(forms: DiscoveredForm[]): ApiEndpoint[] {
  const seen = new Set<string>();
  const endpoints: ApiEndpoint[] = [];

  for (const form of forms) {
    // Deduplicate by action+method so the same login form on every page isn't
    // tested 50 times.
    const key = `${form.method}:${form.action}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Only include fields that have a name — unnamed inputs can't be submitted.
    // Exclude purely decorative types that carry no user-controlled data.
    const injectableFields = form.fields
      .filter((f) => f.name && !['submit', 'button', 'reset', 'image', 'file', 'hidden'].includes(f.type))
      .map((f) => f.name);

    if (injectableFields.length === 0) continue;

    let parsed: URL;
    try {
      parsed = new URL(form.action);
    } catch {
      continue;
    }

    // For GET forms, query params come from the form fields.
    // For POST forms, we also expose them as queryParams so the scanner can
    // synthesise a POST body (the scanner's makeRequest already supports this).
    const queryParams = form.method === 'GET'
      ? [...Array.from(parsed.searchParams.keys()), ...injectableFields]
      : injectableFields;

    endpoints.push({
      url: form.action,
      method: form.method,
      baseUrl: `${parsed.protocol}//${parsed.host}`,
      path: parsed.pathname,
      queryParams: [...new Set(queryParams)], // dedupe
      requestContentType: form.method === 'POST' ? 'application/x-www-form-urlencoded' : null,
      responseContentType: null,
      statusCode: null,
      durationMs: 0,
      hasAuth: false,
      authType: null,
      jwts: [],
      sensitiveLeaks: [],
      // Tag so the vuln scanner knows to send POST body instead of query params
      isFormEndpoint: true,
    } as ApiEndpoint & { isFormEndpoint: boolean });
  }

  return endpoints;
}

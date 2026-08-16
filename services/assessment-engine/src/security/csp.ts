import type { NetworkRequest } from '../types.js';

export type CspIssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CspIssue {
  directive: string;
  value: string;
  severity: CspIssueSeverity;
  issue: string;
  recommendation: string;
}

export interface CspReport {
  present: boolean;
  raw: string | null;
  directives: Record<string, string[]>;
  issues: CspIssue[];
  score: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

// ── Additional security headers checked here since csp.ts owns the document ──
export interface SecurityHeadersReport {
  csp: CspReport;
  missingHeaders: MissingHeaderFinding[];
  cookieIssues: CookieIssue[];
}

export interface MissingHeaderFinding {
  header: string;
  severity: CspIssueSeverity;
  issue: string;
  recommendation: string;
}

export interface CookieIssue {
  name: string;
  severity: CspIssueSeverity;
  issue: string;
  flags: string;
}

const REQUIRED_DIRECTIVES = ['default-src', 'script-src', 'style-src', 'img-src', 'connect-src'];

// ── Security headers that should be present on every HTML document response ──
const REQUIRED_SECURITY_HEADERS: Array<{
  header: string;
  severity: CspIssueSeverity;
  issue: string;
  recommendation: string;
}> = [
  {
    header: 'x-content-type-options',
    severity: 'medium',
    issue: 'Missing X-Content-Type-Options header',
    recommendation: 'Add X-Content-Type-Options: nosniff to prevent MIME-type sniffing attacks',
  },
  {
    header: 'x-frame-options',
    severity: 'medium',
    issue: 'Missing X-Frame-Options header',
    recommendation: 'Add X-Frame-Options: SAMEORIGIN (or use CSP frame-ancestors instead)',
  },
  {
    header: 'referrer-policy',
    severity: 'low',
    issue: 'Missing Referrer-Policy header',
    recommendation: 'Add Referrer-Policy: strict-origin-when-cross-origin to limit referrer leaks',
  },
  {
    header: 'permissions-policy',
    severity: 'low',
    issue: 'Missing Permissions-Policy header',
    recommendation: 'Add Permissions-Policy to restrict browser features (camera, mic, geolocation)',
  },
  {
    header: 'cross-origin-opener-policy',
    severity: 'low',
    issue: 'Missing Cross-Origin-Opener-Policy header',
    recommendation: 'Add Cross-Origin-Opener-Policy: same-origin for cross-origin isolation (Spectre mitigation)',
  },
];

export function analyzeCsp(requests: NetworkRequest[]): CspReport {
  const doc = requests.find(r => r.resourceType === 'document') ?? requests[0];
  if (!doc) return emptyReport();

  const lh = Object.fromEntries(
    Object.entries(doc.responseHeaders).map(([k, v]) => [k.toLowerCase(), v])
  );

  const raw = lh['content-security-policy'] ?? lh['content-security-policy-report-only'] ?? null;
  const isReportOnly = !lh['content-security-policy'] && !!lh['content-security-policy-report-only'];

  if (!raw) {
    return {
      present: false, raw: null, directives: {}, score: 0, grade: 'F',
      issues: [{
        directive: 'content-security-policy', value: 'missing', severity: 'critical',
        issue: 'No Content-Security-Policy header found',
        recommendation: 'Add a CSP header to prevent XSS and data injection attacks',
      }],
    };
  }

  // Parse directives
  const directives: Record<string, string[]> = {};
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [directive, ...values] = trimmed.split(/\s+/);
    directives[directive.toLowerCase()] = values;
  }

  const issues: CspIssue[] = [];

  if (isReportOnly) {
    issues.push({
      directive: 'content-security-policy-report-only', value: '', severity: 'medium',
      issue: 'CSP is in report-only mode — not enforced',
      recommendation: 'Switch to Content-Security-Policy header to enforce the policy',
    });
  }

  // Check for unsafe-inline in script-src
  const scriptSrc = directives['script-src'] ?? directives['default-src'] ?? [];
  if (scriptSrc.includes("'unsafe-inline'")) {
    issues.push({
      directive: 'script-src', value: "'unsafe-inline'", severity: 'critical',
      issue: "'unsafe-inline' in script-src allows inline script execution — negates XSS protection",
      recommendation: "Remove 'unsafe-inline' and use nonces or hashes instead",
    });
  }

  // Check for unsafe-eval
  if (scriptSrc.includes("'unsafe-eval'")) {
    issues.push({
      directive: 'script-src', value: "'unsafe-eval'", severity: 'high',
      issue: "'unsafe-eval' allows eval() and Function() — opens code injection vector",
      recommendation: "Remove 'unsafe-eval' — refactor code to avoid eval()",
    });
  }

  // Check for wildcard sources
  for (const [dir, vals] of Object.entries(directives)) {
    if (vals.includes('*')) {
      issues.push({
        directive: dir, value: '*', severity: 'high',
        issue: `Wildcard source (*) in ${dir} allows loading from any origin`,
        recommendation: `Replace * with specific allowed origins in ${dir}`,
      });
    }
    // Check for http: scheme (allows any HTTP source — bypasses HTTPS enforcement)
    if (vals.includes('http:')) {
      issues.push({
        directive: dir, value: 'http:', severity: 'high',
        issue: `http: scheme in ${dir} allows loading resources over insecure HTTP`,
        recommendation: 'Remove http: scheme — use specific HTTPS origins',
      });
    }
    // data: in script-src enables base64-encoded XSS payloads
    if (dir === 'script-src' && vals.includes('data:')) {
      issues.push({
        directive: dir, value: 'data:', severity: 'high',
        issue: "data: URI in script-src can be used to inject base64-encoded scripts (XSS)",
        recommendation: "Remove data: from script-src",
      });
    }
  }

  // Check for missing important directives
  for (const required of REQUIRED_DIRECTIVES) {
    if (!directives[required] && !directives['default-src']) {
      issues.push({
        directive: required, value: 'missing', severity: 'medium',
        issue: `Missing ${required} directive (no default-src fallback)`,
        recommendation: `Add ${required} directive or a default-src fallback`,
      });
    }
  }

  // Clickjacking: frame-ancestors in CSP is preferred over X-Frame-Options
  if (!directives['frame-ancestors']) {
    issues.push({
      directive: 'frame-ancestors', value: 'missing', severity: 'medium',
      issue: "Missing frame-ancestors directive — no clickjacking protection via CSP",
      recommendation: "Add frame-ancestors 'none' or 'self' to prevent framing",
    });
  }

  // upgrade-insecure-requests ensures HTTP sub-resources are upgraded automatically
  if (!directives['upgrade-insecure-requests'] && !directives['block-all-mixed-content']) {
    issues.push({
      directive: 'upgrade-insecure-requests', value: 'missing', severity: 'low',
      issue: "Missing upgrade-insecure-requests directive — mixed content may load over HTTP",
      recommendation: "Add upgrade-insecure-requests to auto-upgrade HTTP resources to HTTPS",
    });
  }

  // Score calculation — weighted by severity type, not just count
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'critical') score -= 30;
    else if (issue.severity === 'high') score -= 20;
    else if (issue.severity === 'medium') score -= 10;
    else if (issue.severity === 'low') score -= 5;
  }
  score = Math.max(0, score);

  const grade: CspReport['grade'] =
    score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 30 ? 'D' : 'F';

  return { present: true, raw, directives, issues, score, grade };
}

/**
 * Checks all security headers beyond CSP on the document response.
 * Previously these were never checked anywhere in the codebase.
 */
export function analyzeSecurityHeaders(requests: NetworkRequest[]): MissingHeaderFinding[] {
  const doc = requests.find(r => r.resourceType === 'document') ?? requests[0];
  if (!doc) return [];

  const lh = Object.fromEntries(
    Object.entries(doc.responseHeaders).map(([k, v]) => [k.toLowerCase(), v])
  );

  const findings: MissingHeaderFinding[] = [];

  for (const check of REQUIRED_SECURITY_HEADERS) {
    if (!lh[check.header]) {
      findings.push({
        header: check.header,
        severity: check.severity,
        issue: check.issue,
        recommendation: check.recommendation,
      });
    }
  }

  // X-Frame-Options: if present, check for ALLOW-FROM (deprecated/ignored by modern browsers)
  const xfo = lh['x-frame-options'];
  if (xfo && xfo.trim().toUpperCase().startsWith('ALLOW-FROM')) {
    findings.push({
      header: 'x-frame-options',
      severity: 'medium',
      issue: 'X-Frame-Options: ALLOW-FROM is deprecated and ignored by Chrome/Firefox/Safari',
      recommendation: 'Use CSP frame-ancestors instead for per-origin framing control',
    });
  }

  // X-Content-Type-Options: only valid value is "nosniff"
  const xcto = lh['x-content-type-options'];
  if (xcto && xcto.trim().toLowerCase() !== 'nosniff') {
    findings.push({
      header: 'x-content-type-options',
      severity: 'low',
      issue: `X-Content-Type-Options has unexpected value: "${xcto}" — only "nosniff" is valid`,
      recommendation: 'Set X-Content-Type-Options: nosniff',
    });
  }

  return findings;
}

/**
 * Analyzes Set-Cookie headers for missing security flags.
 */
export function analyzeCookies(requests: NetworkRequest[]): CookieIssue[] {
  const issues: CookieIssue[] = [];

  for (const req of requests) {
    const lh = Object.fromEntries(
      Object.entries(req.responseHeaders).map(([k, v]) => [k.toLowerCase(), v])
    );
    const setCookie = lh['set-cookie'];
    if (!setCookie) continue;

    // set-cookie can be a single string or multiple (from the HAR it's usually joined)
    const cookies = setCookie.split(/,(?=[^;]+=[^;]+)/);

    for (const cookie of cookies) {
      const namePart = cookie.split(';')[0] ?? '';
      const name = namePart.split('=')[0]?.trim() ?? 'unknown';
      const flags = cookie.toLowerCase();
      const cookieIssues: string[] = [];

      if (!flags.includes('httponly')) cookieIssues.push('missing HttpOnly');
      if (!flags.includes('secure')) cookieIssues.push('missing Secure');
      if (!flags.includes('samesite')) cookieIssues.push('missing SameSite');

      if (cookieIssues.length > 0) {
        // Only flag session-like cookies (names that suggest auth/session tokens)
        const isSessionCookie = /sess|token|auth|jwt|csrf|remember|sid/i.test(name);
        const severity: CspIssueSeverity = isSessionCookie ? 'high' : 'medium';

        issues.push({
          name,
          severity,
          issue: `Cookie "${name}" has insecure flags: ${cookieIssues.join(', ')}`,
          flags: cookie.split(';').slice(1).join(';').trim(),
        });
      }
    }
  }

  return issues;
}

function emptyReport(): CspReport {
  return { present: false, raw: null, directives: {}, issues: [], score: 0, grade: 'F' };
}

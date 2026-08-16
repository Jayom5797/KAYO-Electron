import { describe, it, expect } from 'vitest';
import type { NetworkRequest } from '../types.js';
import { analyzeCsp, analyzeSecurityHeaders, analyzeCookies } from '../security/csp.js';
import { analyzeCors } from '../security/cors.js';
import { extractApiEndpoints } from '../security/apiExtractor.js';
import { fingerprintTechnologies } from '../security/fingerprint.js';
import { findMixedContent } from '../security/mixedContent.js';

// ── Test fixture builder ──────────────────────────────────────────────────────
function req(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    url: 'https://example.com/',
    method: 'GET',
    resourceType: 'document',
    statusCode: 200,
    sizeBytes: 100,
    ttfbMs: 10,
    durationMs: 20,
    requestHeaders: {},
    responseHeaders: {},
    failed: false,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSP analyzer
// ─────────────────────────────────────────────────────────────────────────────
describe('analyzeCsp', () => {
  it('grades F and flags critical when no CSP header is present', () => {
    const report = analyzeCsp([req()]);
    expect(report.present).toBe(false);
    expect(report.grade).toBe('F');
    expect(report.issues.some(i => i.severity === 'critical')).toBe(true);
  });

  it("flags 'unsafe-inline' in script-src as critical", () => {
    const report = analyzeCsp([req({
      responseHeaders: { 'content-security-policy': "script-src 'self' 'unsafe-inline'; frame-ancestors 'none'" },
    })]);
    expect(report.present).toBe(true);
    expect(report.issues.some(i => i.value === "'unsafe-inline'" && i.severity === 'critical')).toBe(true);
  });

  it('flags wildcard sources as high severity', () => {
    const report = analyzeCsp([req({
      responseHeaders: { 'content-security-policy': "default-src *" },
    })]);
    expect(report.issues.some(i => i.value === '*' && i.severity === 'high')).toBe(true);
  });

  it('detects report-only mode', () => {
    const report = analyzeCsp([req({
      responseHeaders: { 'content-security-policy-report-only': "default-src 'self'" },
    })]);
    expect(report.issues.some(i => /report-only/i.test(i.issue))).toBe(true);
  });

  it('score never goes below 0', () => {
    const report = analyzeCsp([req({
      responseHeaders: { 'content-security-policy': "script-src 'unsafe-inline' 'unsafe-eval' * http: data:" },
    })]);
    expect(report.score).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Security headers
// ─────────────────────────────────────────────────────────────────────────────
describe('analyzeSecurityHeaders', () => {
  it('flags all missing headers on a bare response', () => {
    const findings = analyzeSecurityHeaders([req()]);
    const headers = findings.map(f => f.header);
    expect(headers).toContain('x-content-type-options');
    expect(headers).toContain('x-frame-options');
    expect(headers).toContain('referrer-policy');
    expect(headers).toContain('permissions-policy');
  });

  it('does not flag headers that are present and valid', () => {
    const findings = analyzeSecurityHeaders([req({
      responseHeaders: {
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'SAMEORIGIN',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'permissions-policy': 'geolocation=()',
        'cross-origin-opener-policy': 'same-origin',
      },
    })]);
    expect(findings.length).toBe(0);
  });

  it('flags deprecated X-Frame-Options: ALLOW-FROM', () => {
    const findings = analyzeSecurityHeaders([req({
      responseHeaders: {
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'ALLOW-FROM https://example.com',
        'referrer-policy': 'no-referrer',
        'permissions-policy': 'geolocation=()',
        'cross-origin-opener-policy': 'same-origin',
      },
    })]);
    expect(findings.some(f => /ALLOW-FROM/i.test(f.issue))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cookie analyzer
// ─────────────────────────────────────────────────────────────────────────────
describe('analyzeCookies', () => {
  it('rates a session cookie missing all flags as high severity', () => {
    const issues = analyzeCookies([req({
      responseHeaders: { 'set-cookie': 'sessionid=abc123; Path=/' },
    })]);
    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe('high');
    expect(issues[0].issue).toMatch(/HttpOnly/);
  });

  it('does not flag a cookie with all flags set', () => {
    const issues = analyzeCookies([req({
      responseHeaders: { 'set-cookie': 'sessionid=abc; HttpOnly; Secure; SameSite=Strict' },
    })]);
    expect(issues.length).toBe(0);
  });

  it('rates a non-session cookie lower than a session cookie', () => {
    const issues = analyzeCookies([req({
      responseHeaders: { 'set-cookie': 'theme=dark; Path=/' },
    })]);
    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe('medium');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CORS analyzer — false-positive regression guards
// ─────────────────────────────────────────────────────────────────────────────
describe('analyzeCors', () => {
  it('flags wildcard + credentials as critical', () => {
    const report = analyzeCors([req({
      resourceType: 'xhr',
      responseHeaders: {
        'access-control-allow-origin': '*',
        'access-control-allow-credentials': 'true',
      },
    })]);
    expect(report.findings.some(f => f.riskLevel === 'critical')).toBe(true);
  });

  it('flags wildcard CORS on an API endpoint as high', () => {
    const report = analyzeCors([req({
      url: 'https://api.example.com/data',
      resourceType: 'fetch',
      responseHeaders: { 'access-control-allow-origin': '*' },
    })]);
    expect(report.findings.some(f => f.riskLevel === 'high')).toBe(true);
  });

  it('does NOT flag standard auth headers in ACAH (regression: was a false positive)', () => {
    const report = analyzeCors([req({
      url: 'https://example.com/api',
      resourceType: 'fetch',
      responseHeaders: {
        'access-control-allow-origin': 'https://example.com',
        'access-control-allow-headers': 'authorization, content-type',
      },
    })]);
    expect(report.findings.some(f => /authorization header/i.test(f.issue))).toBe(false);
  });

  it('does NOT flag DELETE/PUT/PATCH methods (regression: was a false positive)', () => {
    const report = analyzeCors([req({
      resourceType: 'fetch',
      responseHeaders: {
        'access-control-allow-origin': 'https://example.com',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, PATCH',
      },
    })]);
    expect(report.findings.some(f => /method/i.test(f.issue))).toBe(false);
  });

  it('does NOT flag credentials with a same-site subdomain origin', () => {
    const report = analyzeCors([req({
      url: 'https://example.com/data',
      resourceType: 'fetch',
      responseHeaders: {
        'access-control-allow-origin': 'https://app.example.com',
        'access-control-allow-credentials': 'true',
      },
    })]);
    // app.example.com is a subdomain of the target example.com — treated as trusted
    expect(report.findings.some(f => /credentials allowed for cross-origin third-party/i.test(f.issue))).toBe(false);
  });

  it('skips requests with no ACAO header entirely', () => {
    const report = analyzeCors([req({ responseHeaders: { 'content-type': 'text/html' } })]);
    expect(report.findings.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API extractor — location-aware leak detection
// ─────────────────────────────────────────────────────────────────────────────
describe('extractApiEndpoints', () => {
  it('does NOT flag a Bearer token in the request Authorization header (regression)', () => {
    const endpoints = extractApiEndpoints([req({
      url: 'https://api.example.com/me',
      resourceType: 'fetch',
      requestHeaders: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.abc.def' },
    })]);
    const leaks = endpoints.flatMap(e => e.sensitiveLeaks);
    expect(leaks.length).toBe(0);
  });

  it('flags a password in the URL query string', () => {
    const endpoints = extractApiEndpoints([req({
      url: 'https://api.example.com/login?user=bob&password=hunter2',
      resourceType: 'xhr',
    })]);
    const leaks = endpoints.flatMap(e => e.sensitiveLeaks);
    expect(leaks.some(l => /password in url/i.test(l.type))).toBe(true);
  });

  it('detects and reports auth type', () => {
    const endpoints = extractApiEndpoints([req({
      url: 'https://api.example.com/data',
      resourceType: 'fetch',
      requestHeaders: { authorization: 'Bearer xyz' },
    })]);
    expect(endpoints[0].hasAuth).toBe(true);
    expect(endpoints[0].authType).toBe('Bearer Token');
  });

  it('decodes a JWT found in a response header', () => {
    // {"alg":"HS256"} . {"sub":"123"} . sig
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature';
    const endpoints = extractApiEndpoints([req({
      url: 'https://api.example.com/token',
      resourceType: 'fetch',
      responseHeaders: { 'x-auth': jwt },
    })]);
    expect(endpoints[0].jwts.length).toBeGreaterThan(0);
    expect(endpoints[0].jwts[0].payload.sub).toBe('123');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprinter
// ─────────────────────────────────────────────────────────────────────────────
describe('fingerprintTechnologies', () => {
  it('detects WordPress from a wp-content URL', () => {
    const fp = fingerprintTechnologies([
      req(),
      req({ url: 'https://example.com/wp-content/themes/x/style.css', resourceType: 'stylesheet' }),
    ], 'https://example.com');
    expect(fp.technologies.some(t => t.name === 'WordPress')).toBe(true);
  });

  it('extracts a version from a ?ver= asset URL', () => {
    const fp = fingerprintTechnologies([
      req({ url: 'https://example.com/wp-content/themes/astra/main.css?ver=4.8.1', resourceType: 'stylesheet' }),
    ], 'https://example.com');
    const wp = fp.technologies.find(t => t.name === 'WordPress' && t.version);
    expect(wp?.version).toBe('4.8.1');
  });

  it('flags xmlrpc.php in captured traffic as CMS attack surface', () => {
    const fp = fingerprintTechnologies([
      req({ url: 'https://example.com/wp-content/x.js', resourceType: 'script' }),
      req({ url: 'https://example.com/xmlrpc.php', resourceType: 'other' }),
    ], 'https://example.com');
    expect(fp.cmsExposure.some(c => /xml-rpc/i.test(c.finding))).toBe(true);
  });

  it('counts third-party domains separately from the target', () => {
    const fp = fingerprintTechnologies([
      req({ url: 'https://example.com/' }),
      req({ url: 'https://www.google-analytics.com/collect', resourceType: 'image' }),
    ], 'https://example.com');
    expect(fp.thirdPartyDomains.some(d => d.domain === 'www.google-analytics.com')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mixed content
// ─────────────────────────────────────────────────────────────────────────────
describe('findMixedContent', () => {
  it('reports nothing when the page is HTTP', () => {
    const report = findMixedContent([req({ url: 'http://example.com/a.js', resourceType: 'script' })], 'http://example.com');
    expect(report.present).toBe(false);
    expect(report.pageIsHttps).toBe(false);
  });

  it('flags an HTTP script on an HTTPS page as high-severity active content', () => {
    const report = findMixedContent([
      req({ url: 'https://example.com/' }),
      req({ url: 'http://cdn.example.com/lib.js', resourceType: 'script' }),
    ], 'https://example.com');
    expect(report.present).toBe(true);
    const f = report.findings.find(x => x.url === 'http://cdn.example.com/lib.js');
    expect(f?.category).toBe('active');
    expect(f?.severity).toBe('high');
  });

  it('flags an HTTP image as medium-severity passive content', () => {
    const report = findMixedContent([
      req({ url: 'https://example.com/' }),
      req({ url: 'http://cdn.example.com/pic.png', resourceType: 'image' }),
    ], 'https://example.com');
    const f = report.findings.find(x => x.resourceType === 'image');
    expect(f?.category).toBe('passive');
    expect(f?.severity).toBe('medium');
  });

  it('does not flag HTTPS sub-resources', () => {
    const report = findMixedContent([
      req({ url: 'https://example.com/' }),
      req({ url: 'https://cdn.example.com/lib.js', resourceType: 'script' }),
    ], 'https://example.com');
    expect(report.findings.length).toBe(0);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { captureNetwork } from '../capture.js';
import type { CaptureResult } from '../types.js';
import { analyzeCsp, analyzeSecurityHeaders, analyzeCookies } from '../security/csp.js';
import { analyzeCors } from '../security/cors.js';
import { startFixtureServer, type FixtureServer } from './fixtureServer.js';

// These tests drive a real headless Chromium (via Playwright) against a local
// fixture server. They cover the capture pipeline and the security analyzers
// end-to-end — the parts that pure unit tests can't reach. Chromium must be
// installed (`npx playwright install chromium`); CI does this automatically.

let fixture: FixtureServer;
let capture: CaptureResult;

beforeAll(async () => {
  fixture = await startFixtureServer();
  capture = await captureNetwork({ url: fixture.url + '/', timeoutMs: 30000 });
}, 60000);

afterAll(async () => {
  await fixture?.close();
});

describe('captureNetwork (integration)', () => {
  it('captures the document plus its sub-resources', () => {
    expect(capture.requests.length).toBeGreaterThanOrEqual(4);

    const doc = capture.requests.find((r) => r.resourceType === 'document');
    expect(doc).toBeDefined();
    expect(doc?.statusCode).toBe(200);
    expect(doc?.sizeBytes).toBeGreaterThan(0);

    const types = new Set(capture.requests.map((r) => r.resourceType));
    expect(types.has('stylesheet')).toBe(true);
    expect(types.has('script')).toBe(true);
    expect(types.has('image')).toBe(true);
  });

  it('records the JSON API call triggered by fetch()', () => {
    const api = capture.requests.find((r) => r.url.endsWith('/api/data'));
    expect(api).toBeDefined();
    expect(api?.statusCode).toBe(200);
  });

  it('produces sane timing and a capture timestamp', () => {
    expect(capture.totalDurationMs).toBeGreaterThan(0);
    expect(() => new Date(capture.captureTimestamp).toISOString()).not.toThrow();
    for (const r of capture.requests) {
      expect(r.ttfbMs).toBeGreaterThanOrEqual(0);
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('security analyzers over captured traffic (golden target)', () => {
  it('grades CSP as F — the fixture serves no policy', () => {
    const report = analyzeCsp(capture.requests);
    expect(report.present).toBe(false);
    expect(report.grade).toBe('F');
    expect(report.issues.some((i) => i.severity === 'critical')).toBe(true);
  });

  it('flags the missing security headers', () => {
    const headers = analyzeSecurityHeaders(capture.requests).map((f) => f.header);
    expect(headers).toContain('x-content-type-options');
    expect(headers).toContain('x-frame-options');
  });

  it('flags the insecure session cookie as high severity', () => {
    const issues = analyzeCookies(capture.requests);
    const session = issues.find((i) => /HttpOnly|Secure|SameSite/.test(i.issue));
    expect(session).toBeDefined();
    expect(session?.severity).toBe('high');
  });

  it('flags the wildcard CORS policy on the API endpoint', () => {
    const report = analyzeCors(capture.requests);
    const wildcard = report.findings.find((f) => f.url.endsWith('/api/data'));
    expect(wildcard).toBeDefined();
    expect(wildcard?.value).toBe('*');
    expect(wildcard?.riskLevel).toBe('high');
  });
});

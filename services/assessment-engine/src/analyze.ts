import type { NetworkRequest, DiscoveredForm } from './types.js';
import type { ApiEndpoint } from './security/apiExtractor.js';
import { normalizeAndValidate } from './url.js';
import { captureNetwork } from './capture.js';
import { processRequests } from './metrics.js';
import { generateHar } from './har.js';
import { inspectTls } from './security/tls.js';
import { analyzeCors } from './security/cors.js';
import { extractApiEndpoints, formsToApiEndpoints } from './security/apiExtractor.js';
import { fingerprintTechnologies } from './security/fingerprint.js';
import { runDnsRecon } from './security/dns.js';
import { analyzeCsp, analyzeSecurityHeaders, analyzeCookies } from './security/csp.js';
import { runVulnScan } from './security/vulnScanner.js';
import { findMixedContent } from './security/mixedContent.js';
import { correlateCves } from './security/cve.js';

export interface ScanOptions {
  /** Run the INTRUSIVE active vulnerability scan. Off by default. */
  activeScan?: boolean;
  /** Capture timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Max pages to spider before running the active scan.
   * Default 1 (landing page only).
   * Set to 25-50 for a full-site scan.
   */
  maxPages?: number;
}

const EMPTY_VULN = {
  findings: { sqli: [], xss: [], idor: [], pathTraversal: [], openRedirect: [], infoDisclosure: [] },
  scannedEndpoints: 0,
  duration: 0,
};

/**
 * Runs the full security analysis suite over a set of captured requests.
 *
 * forms — discovered HTML forms from the spider, converted to injectable
 * ApiEndpoints so the active scanner can probe login pages, search boxes, etc.
 */
export async function analyzeSecurity(
  url: string,
  requests: NetworkRequest[],
  options: ScanOptions = {},
  forms: DiscoveredForm[] = [],
) {
  const [tlsResult, corsReport, apiEndpoints, fingerprint, dnsReport, cspReport] =
    await Promise.allSettled([
      inspectTls(url),
      Promise.resolve(analyzeCors(requests)),
      Promise.resolve(extractApiEndpoints(requests)),
      Promise.resolve(fingerprintTechnologies(requests, url)),
      runDnsRecon(requests, url),
      Promise.resolve(analyzeCsp(requests)),
    ]);

  const api = apiEndpoints.status === 'fulfilled' ? apiEndpoints.value : [];

  // Merge form-derived endpoints — these give the active scanner access to
  // login forms, search boxes, contact forms, etc. found across all crawled pages.
  const formEndpoints = formsToApiEndpoints(forms);
  const allEndpoints = mergeEndpoints(api, formEndpoints);

  const securityHeaders = analyzeSecurityHeaders(requests);
  const cookieIssues = analyzeCookies(requests);
  const mixedContent = findMixedContent(requests, url);

  let fingerprintValue = fingerprint.status === 'fulfilled' ? fingerprint.value : null;
  if (fingerprintValue) {
    try {
      const cves = await correlateCves(fingerprintValue.technologies);
      fingerprintValue = { ...fingerprintValue, cves };
    } catch { /* CVE lookup is best-effort */ }
  }

  const vuln =
    options.activeScan === true
      ? await runVulnScan(allEndpoints).catch(() => EMPTY_VULN)
      : { ...EMPTY_VULN, skipped: true };

  return {
    tls: tlsResult.status === 'fulfilled' ? tlsResult.value : { error: (tlsResult.reason as Error).message },
    cors: corsReport.status === 'fulfilled' ? corsReport.value : { findings: [], summary: {} },
    api: allEndpoints,
    fingerprint: fingerprintValue,
    dns: dnsReport.status === 'fulfilled' ? dnsReport.value : null,
    csp: cspReport.status === 'fulfilled' ? cspReport.value : null,
    securityHeaders,
    cookieIssues,
    mixedContent,
    vuln,
    formsDiscovered: forms.length,
  };
}

/**
 * Merge network-observed endpoints and form-derived endpoints, deduplicating
 * by action+method so the same endpoint isn't tested twice.
 */
function mergeEndpoints(
  observed: ApiEndpoint[],
  fromForms: ApiEndpoint[],
): ApiEndpoint[] {
  const seen = new Set(observed.map((e) => `${e.method}:${e.url}`));
  const unique = fromForms.filter((e) => {
    const key = `${e.method}:${e.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...observed, ...unique];
}

export type SecurityFindings = Awaited<ReturnType<typeof analyzeSecurity>>;

export type PostureRating = 'Critical' | 'High' | 'Medium' | 'Low' | 'Good';

export interface PostureSummary {
  rating: PostureRating;
  score: number; // 0-100 (higher is better)
  counts: { critical: number; high: number; medium: number; low: number };
}

/**
 * Aggregates every security module into a single overall posture. The rating is
 * driven by the worst severity present (consistent with how the TLS/CSP grades
 * work), while the score gives a weighted 0-100 view.
 */
export function computePosture(sec: SecurityFindings): PostureSummary {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  const bump = (sev: string) => {
    if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') counts[sev]++;
  };

  if (sec.tls && !('error' in sec.tls)) sec.tls.issues.forEach((i) => bump(i.severity));
  if (sec.csp) sec.csp.issues.forEach((i) => bump(i.severity));
  sec.securityHeaders.forEach((h) => bump(h.severity));
  sec.cookieIssues.forEach((c) => bump(c.severity));
  if ('findings' in sec.cors) sec.cors.findings.forEach((f) => bump(f.riskLevel));
  sec.mixedContent.findings.forEach((f) => bump(f.severity));

  const cves =
    (sec.fingerprint as { cves?: Array<{ severity: string }> } | null)?.cves ?? [];
  cves.forEach((c) => bump(c.severity === 'unknown' ? 'low' : c.severity));

  if (sec.fingerprint?.cmsExposure) sec.fingerprint.cmsExposure.forEach((c) => bump(c.severity));

  // Any leaked secret is treated as high severity.
  sec.api.forEach((e) => e.sensitiveLeaks.forEach(() => bump('high')));

  if (!('skipped' in sec.vuln && sec.vuln.skipped)) {
    const v = sec.vuln.findings;
    [...v.sqli, ...v.xss, ...v.idor, ...v.pathTraversal, ...v.openRedirect, ...v.infoDisclosure].forEach(
      (f) => bump(f.severity)
    );
  }

  const rating: PostureRating = counts.critical
    ? 'Critical'
    : counts.high
      ? 'High'
      : counts.medium
        ? 'Medium'
        : counts.low
          ? 'Low'
          : 'Good';

  const penalty = counts.critical * 25 + counts.high * 10 + counts.medium * 4 + counts.low * 1;
  const score = Math.max(0, Math.min(100, 100 - penalty));

  return { rating, score, counts };
}

/**
 * End-to-end scan: validate → spider → capture → metrics → HAR → full security analysis.
 * Returns the consolidated result object shared by all front-ends.
 */
export async function runScan(rawUrl: string, options: ScanOptions = {}) {
  const validation = normalizeAndValidate(rawUrl);
  if (!validation.ok) throw new Error(validation.error);

  const capture = await captureNetwork({
    url: validation.url,
    timeoutMs: options.timeoutMs ?? 60000,
    maxPages: options.maxPages ?? 1,
    sameOriginOnly: true,
  });

  const data = processRequests(capture.requests);
  const har = generateHar(capture.requests, capture.captureTimestamp);
  const security = await analyzeSecurity(validation.url, capture.requests, options, capture.forms ?? []);

  return {
    url: validation.url,
    captureTimestamp: capture.captureTimestamp,
    totalDurationMs: capture.totalDurationMs,
    pagesScanned: capture.discoveredUrls?.length ?? 1,
    pagesDiscovered: capture.discoveredUrls ?? [validation.url],
    formsDiscovered: security.formsDiscovered,
    aggregate: data.aggregate,
    byType: data.byType,
    slowest: data.slowest,
    errors: data.errors,
    requests: data.requests,
    har,
    ...security,
    posture: computePosture(security),
  };
}

export type ScanResult = Awaited<ReturnType<typeof runScan>>;

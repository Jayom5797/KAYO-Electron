import type { NetworkRequest } from '../types.js';

// Well-known CDN, analytics, and font domains where wildcard CORS is
// intentional and expected — not a security finding.
const TRUSTED_THIRD_PARTY_DOMAINS = [
  'googleapis.com', 'gstatic.com', 'google.com', 'googletagmanager.com',
  'googleanalytics.com', 'doubleclick.net', 'googlesyndication.com',
  'cloudflareinsights.com', 'cloudflare.com',
  'fontawesome.com', 'jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com',
  'bootstrapcdn.com', 'jquery.com',
  'facebook.com', 'facebook.net', 'fbcdn.net',
  'twitter.com', 'twimg.com',
  'linkedin.com', 'licdn.com',
  'instagram.com', 'cdninstagram.com',
  'youtube.com', 'ytimg.com',
  'amazon.com', 'amazonaws.com', 'cloudfront.net',
  'akamaized.net', 'akamai.net',
  'fastly.net', 'fastly.com',
  'stripe.com', 'stripe.network',
  'intercom.io', 'intercomcdn.com',
  'hotjar.com', 'mixpanel.com', 'segment.com', 'segment.io',
  'sentry.io', 'browser.sentry-cdn.com',
  'newrelic.com', 'nr-data.net',
  'wp.com', 'wp-content.com', 'wordpress.com',
];

function isTrustedThirdParty(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return TRUSTED_THIRD_PARTY_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

export type CorsRiskLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CorsFinding {
  url: string;
  method: string;
  riskLevel: CorsRiskLevel;
  issue: string;
  detail: string;
  header: string;
  value: string;
}

export interface CorsReport {
  findings: CorsFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

/**
 * Returns true if `origin` is a subdomain of or equal to `host`.
 * Used to decide whether a reflected origin is "trusted" (same site).
 */
function isSameOrSubdomain(origin: string, requestHost: string): boolean {
  try {
    const o = new URL(origin).hostname;
    return o === requestHost || o.endsWith('.' + requestHost);
  } catch {
    return false;
  }
}

export function analyzeCors(requests: NetworkRequest[]): CorsReport {
  const findings: CorsFinding[] = [];

  for (const req of requests) {
    const h = Object.fromEntries(
      Object.entries(req.responseHeaders).map(([k, v]) => [k.toLowerCase(), v])
    );

    const acao = h['access-control-allow-origin'];
    const acac = h['access-control-allow-credentials'];
    // NOTE: Access-Control-Allow-Methods and Access-Control-Allow-Headers are
    // intentionally NOT inspected — flagging DELETE/PUT/PATCH or Authorization
    // produced false positives on normal REST/SPA behavior (see note below).

    if (!acao) continue;

    let reqHost = '';
    try { reqHost = new URL(req.url).hostname; } catch { /* skip */ }

    // ── CRITICAL: wildcard + credentials ─────────────────────────────────────
    if (acao === '*' && acac === 'true' && !isTrustedThirdParty(req.url)) {
      findings.push({
        url: req.url, method: req.method, riskLevel: 'critical',
        issue: 'Wildcard origin with credentials flag',
        detail: 'ACAO: * with ACAC: true is rejected by browsers but indicates a broken CORS ' +
                'implementation that may work in non-browser clients or future spec changes.',
        header: 'Access-Control-Allow-Origin', value: acao,
      });
    }

    // ── HIGH: wildcard on XHR/fetch API endpoints ─────────────────────────────
    if (acao === '*' && (req.resourceType === 'xhr' || req.resourceType === 'fetch') && !isTrustedThirdParty(req.url)) {
      findings.push({
        url: req.url, method: req.method, riskLevel: 'high',
        issue: 'Wildcard CORS on API endpoint',
        detail: 'Any origin can make cross-origin requests to this API and read responses. ' +
                'If the endpoint returns sensitive data, it is exposed to any website.',
        header: 'Access-Control-Allow-Origin', value: acao,
      });
    }

    // ── HIGH: credentials allowed with an UNTRUSTED specific origin ───────────
    if (acao !== '*' && acac === 'true' && reqHost && !isSameOrSubdomain(acao, reqHost) && !isTrustedThirdParty(req.url)) {
      findings.push({
        url: req.url, method: req.method, riskLevel: 'high',
        issue: 'Credentials allowed for cross-origin third-party requests',
        detail: `Origin "${acao}" is not a subdomain of "${reqHost}" but can make credentialed ` +
                'cross-origin requests. Verify this external origin is fully trusted.',
        header: 'Access-Control-Allow-Credentials', value: acac,
      });
    }

    // ── MEDIUM: origin reflection — skip trusted CDNs ─────────────────────
    if (
      acao !== '*' &&
      !isSameOrSubdomain(acao, reqHost) &&
      acac !== 'true' &&
      /^https?:\/\//.test(acao) &&
      !isTrustedThirdParty(req.url) &&
      !isTrustedThirdParty(acao)
    ) {
      findings.push({
        url: req.url, method: req.method, riskLevel: 'medium',
        issue: 'Cross-origin access granted to external domain',
        detail: `Responses are readable by "${acao}". Confirm this origin is an intended partner.`,
        header: 'Access-Control-Allow-Origin', value: acao,
      });
    }

    // ── LOW: wildcard on static/non-API resource — skip trusted CDNs ────────
    if (acao === '*' && req.resourceType !== 'xhr' && req.resourceType !== 'fetch' && !isTrustedThirdParty(req.url)) {
      findings.push({
        url: req.url, method: req.method, riskLevel: 'low',
        issue: 'Wildcard CORS on static resource',
        detail: 'Public resource allows any origin — generally acceptable for CDN/font assets.',
        header: 'Access-Control-Allow-Origin', value: acao,
      });
    }

    // NOTE: We intentionally do NOT flag:
    // - DELETE/PUT/PATCH in ACAM — REST APIs are supposed to use these methods
    // - Authorization in ACAH — SPAs routinely and correctly send Bearer tokens cross-origin
    // These were false positives in the previous version.
  }

  // Deduplicate: same URL + same issue only reported once
  const seen = new Set<string>();
  const unique = findings.filter(f => {
    const key = `${f.url}::${f.issue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const summary = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of unique) {
    if (f.riskLevel in summary) summary[f.riskLevel as keyof typeof summary]++;
  }

  return { findings: unique, summary };
}

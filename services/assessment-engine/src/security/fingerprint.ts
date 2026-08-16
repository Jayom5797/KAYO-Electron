import type { NetworkRequest } from '../types.js';
import type { CveFinding } from './cve.js';

export interface TechSignature {
  name: string;
  category: 'framework' | 'cms' | 'server' | 'cdn' | 'analytics' | 'payment' | 'auth' | 'language' | 'library';
  confidence: 'high' | 'medium' | 'low';
  version?: string;
  evidence: string;
}

export interface FingerprintReport {
  technologies: TechSignature[];
  serverSoftware: string | null;
  poweredBy: string | null;
  thirdPartyDomains: ThirdPartyDomain[];
  /** CMS-specific attack surface findings — e.g. WordPress xmlrpc, user enumeration */
  cmsExposure: CmsExposureFinding[];
  /** Known CVEs for fingerprinted components (populated by the cve module). */
  cves?: CveFinding[];
}

export interface ThirdPartyDomain {
  domain: string;
  category: string;
  requestCount: number;
  totalBytes: number;
}

export interface CmsExposureFinding {
  cms: string;
  severity: 'high' | 'medium' | 'low';
  finding: string;
  detail: string;
  url?: string;
}

// ── Header-based signatures ───────────────────────────────────────────────────
const HEADER_SIGNATURES: Array<{
  header: string;
  pattern: RegExp;
  name: string;
  category: TechSignature['category'];
  confidence: TechSignature['confidence'];
}> = [
  { header: 'x-powered-by',        pattern: /PHP\/([\d.]+)/i,          name: 'PHP',               category: 'language',  confidence: 'high' },
  { header: 'x-powered-by',        pattern: /ASP\.NET/i,               name: 'ASP.NET',           category: 'framework', confidence: 'high' },
  { header: 'x-powered-by',        pattern: /Express/i,                name: 'Express.js',        category: 'framework', confidence: 'high' },
  { header: 'x-powered-by',        pattern: /Next\.js/i,               name: 'Next.js',           category: 'framework', confidence: 'high' },
  { header: 'server',              pattern: /nginx\/([\d.]+)/i,        name: 'nginx',             category: 'server',    confidence: 'high' },
  { header: 'server',              pattern: /Apache\/([\d.]+)/i,       name: 'Apache',            category: 'server',    confidence: 'high' },
  { header: 'server',              pattern: /^Apache$/i,               name: 'Apache',            category: 'server',    confidence: 'medium' },
  { header: 'server',              pattern: /cloudflare/i,             name: 'Cloudflare',        category: 'cdn',       confidence: 'high' },
  { header: 'server',              pattern: /AmazonS3/i,               name: 'Amazon S3',         category: 'cdn',       confidence: 'high' },
  { header: 'server',              pattern: /AmazonEC2/i,              name: 'Amazon EC2',        category: 'server',    confidence: 'high' },
  { header: 'server',              pattern: /Microsoft-IIS\/([\d.]+)/i,name: 'IIS',               category: 'server',    confidence: 'high' },
  { header: 'x-generator',         pattern: /WordPress ([\d.]+)/i,     name: 'WordPress',         category: 'cms',       confidence: 'high' },
  { header: 'x-drupal-cache',      pattern: /.+/,                      name: 'Drupal',            category: 'cms',       confidence: 'high' },
  { header: 'x-shopify-stage',     pattern: /.+/,                      name: 'Shopify',           category: 'cms',       confidence: 'high' },
  { header: 'cf-ray',              pattern: /.+/,                      name: 'Cloudflare',        category: 'cdn',       confidence: 'high' },
  { header: 'x-vercel-id',         pattern: /.+/,                      name: 'Vercel',            category: 'cdn',       confidence: 'high' },
  { header: 'x-amz-cf-id',         pattern: /.+/,                      name: 'AWS CloudFront',    category: 'cdn',       confidence: 'high' },
  { header: 'x-cache',             pattern: /cloudfront/i,             name: 'AWS CloudFront',    category: 'cdn',       confidence: 'medium' },
  { header: 'x-fastly-request-id', pattern: /.+/,                      name: 'Fastly CDN',        category: 'cdn',       confidence: 'high' },
  { header: 'x-akamai-transformed',pattern: /.+/,                      name: 'Akamai CDN',        category: 'cdn',       confidence: 'high' },
  { header: 'x-wp-total',          pattern: /.+/,                      name: 'WordPress REST API',category: 'cms',       confidence: 'high' },
  { header: 'x-rails-version',     pattern: /([\d.]+)/,                name: 'Ruby on Rails',     category: 'framework', confidence: 'high' },
  { header: 'x-aspnet-version',    pattern: /([\d.]+)/,                name: 'ASP.NET',           category: 'framework', confidence: 'high' },
];

// ── URL-based signatures with version extraction ──────────────────────────────
const URL_SIGNATURES: Array<{
  pattern: RegExp;
  name: string;
  category: TechSignature['category'];
  confidence: TechSignature['confidence'];
  /** Optional: extract version from a capture group in `pattern` */
  versionGroup?: number;
}> = [
  { pattern: /\/wp-content\//i,                    name: 'WordPress',           category: 'cms',       confidence: 'high' },
  { pattern: /\/wp-admin\//i,                      name: 'WordPress',           category: 'cms',       confidence: 'high' },
  // Extract WordPress/theme version from ?ver= query param
  { pattern: /[?&]ver=([\d.]+)/i,                  name: 'WordPress',           category: 'cms',       confidence: 'medium', versionGroup: 1 },
  { pattern: /\/sites\/default\/files\//i,          name: 'Drupal',              category: 'cms',       confidence: 'high' },
  { pattern: /\/Umbraco\//i,                        name: 'Umbraco',             category: 'cms',       confidence: 'high' },
  { pattern: /react(-dom)?[.-]([\d]+)/i,          name: 'React',               category: 'library',   confidence: 'medium', versionGroup: 2 },
  { pattern: /angular[.-]([\d]+)/i,               name: 'Angular',             category: 'framework', confidence: 'medium', versionGroup: 1 },
  { pattern: /vue[.-]([\d]+)/i,                   name: 'Vue.js',              category: 'framework', confidence: 'medium', versionGroup: 1 },
  { pattern: /jquery[.-]([\d.]+)/i,               name: 'jQuery',              category: 'library',   confidence: 'medium', versionGroup: 1 },
  { pattern: /bootstrap[.-]([\d.]+)/i,            name: 'Bootstrap',           category: 'library',   confidence: 'medium', versionGroup: 1 },
  { pattern: /next[.-]([\d]+)/i,                  name: 'Next.js',             category: 'framework', confidence: 'medium', versionGroup: 1 },
  { pattern: /gtag\/js/i,                           name: 'Google Analytics',    category: 'analytics', confidence: 'high' },
  { pattern: /google-analytics\.com/i,              name: 'Google Analytics',    category: 'analytics', confidence: 'high' },
  { pattern: /googletagmanager\.com/i,              name: 'Google Tag Manager',  category: 'analytics', confidence: 'high' },
  { pattern: /segment\.com\/analytics/i,            name: 'Segment',             category: 'analytics', confidence: 'high' },
  { pattern: /hotjar\.com/i,                        name: 'Hotjar',              category: 'analytics', confidence: 'high' },
  { pattern: /stripe\.com/i,                        name: 'Stripe',              category: 'payment',   confidence: 'high' },
  { pattern: /paypal\.com/i,                        name: 'PayPal',              category: 'payment',   confidence: 'high' },
  { pattern: /auth0\.com/i,                         name: 'Auth0',               category: 'auth',      confidence: 'high' },
  { pattern: /cognito-idp\./i,                      name: 'AWS Cognito',         category: 'auth',      confidence: 'high' },
  { pattern: /accounts\.google\.com/i,              name: 'Google OAuth',        category: 'auth',      confidence: 'high' },
  { pattern: /login\.microsoftonline\.com/i,        name: 'Microsoft OAuth',     category: 'auth',      confidence: 'high' },
];

const THIRD_PARTY_CATEGORIES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /google-analytics|googletagmanager|gtag/i, category: 'Analytics' },
  { pattern: /hotjar|mixpanel|segment|amplitude/i,      category: 'Analytics' },
  { pattern: /facebook\.net|fbcdn/i,                    category: 'Social' },
  { pattern: /twitter\.com|twimg/i,                     category: 'Social' },
  { pattern: /linkedin\.com/i,                          category: 'Social' },
  { pattern: /stripe\.com|paypal\.com|braintree/i,      category: 'Payment' },
  { pattern: /cloudflare|fastly|akamai|cloudfront|cdn/i,category: 'CDN' },
  { pattern: /auth0|cognito|okta|onelogin/i,            category: 'Auth' },
  { pattern: /sentry\.io|bugsnag|rollbar/i,             category: 'Error Tracking' },
  { pattern: /intercom|zendesk|freshdesk|drift/i,       category: 'Support' },
  { pattern: /doubleclick|googlesyndication|adnxs/i,    category: 'Advertising' },
  { pattern: /fonts\.googleapis\.com/i,                 category: 'Fonts (Google)' },
];

function categorizeThirdParty(domain: string): string {
  for (const { pattern, category } of THIRD_PARTY_CATEGORIES) {
    if (pattern.test(domain)) return category;
  }
  return 'Third-party';
}

/**
 * Given that a CMS has been detected, look for known attack-surface exposure
 * using the captured request list. No active probing — passive only.
 */
function detectCmsExposure(
  cms: string,
  requests: NetworkRequest[],
  _targetHost: string,
): CmsExposureFinding[] {
  const findings: CmsExposureFinding[] = [];
  const urls = requests.map(r => r.url);

  if (cms === 'WordPress') {
    // xmlrpc.php: brute-force amplification via system.multicall
    const xmlrpc = urls.find(u => /\/xmlrpc\.php/i.test(u));
    if (xmlrpc) {
      findings.push({
        cms: 'WordPress',
        severity: 'high',
        finding: 'XML-RPC endpoint detected',
        detail: '/xmlrpc.php is accessible. Attackers can use system.multicall to test thousands ' +
                'of passwords in a single HTTP request. Disable unless explicitly needed.',
        url: xmlrpc,
      });
    }

    // WP REST API user enumeration: /wp-json/wp/v2/users
    const wpUsers = urls.find(u => /\/wp-json\/wp\/v2\/users/i.test(u));
    if (wpUsers) {
      findings.push({
        cms: 'WordPress',
        severity: 'medium',
        finding: 'WP REST API user enumeration endpoint in traffic',
        detail: '/wp-json/wp/v2/users exposes usernames and IDs. Disable or restrict to authenticated users.',
        url: wpUsers,
      });
    }

    // WP REST API link header exposure (even if endpoint not directly called)
    const linkHeader = requests.find(r => {
      const lh = Object.fromEntries(
        Object.entries(r.responseHeaders).map(([k, v]) => [k.toLowerCase(), v])
      );
      return /wp-json/i.test(lh['link'] ?? '');
    });
    if (linkHeader && !wpUsers) {
      const lh = Object.fromEntries(
        Object.entries(linkHeader.responseHeaders).map(([k, v]) => [k.toLowerCase(), v])
      );
      findings.push({
        cms: 'WordPress',
        severity: 'low',
        finding: 'WP REST API URL exposed in Link header',
        detail: `Link header reveals WordPress REST API endpoint: "${lh['link']?.slice(0, 120)}". ` +
                'This leaks page IDs and confirms WordPress is in use.',
      });
    }

    // readme.html / license.txt in traffic — reveals WP version
    const versionFiles = urls.find(u => /\/(readme\.html|license\.txt|wp-config\.php)/i.test(u));
    if (versionFiles) {
      findings.push({
        cms: 'WordPress',
        severity: 'medium',
        finding: 'WordPress version disclosure file in traffic',
        detail: 'readme.html or license.txt exposes the exact WordPress version. Remove or restrict these files.',
        url: versionFiles,
      });
    }

    // wp-login.php in traffic
    const wpLogin = urls.find(u => /\/wp-login\.php/i.test(u));
    if (wpLogin) {
      findings.push({
        cms: 'WordPress',
        severity: 'low',
        finding: 'WordPress login page accessible',
        detail: '/wp-login.php is reachable. Consider restricting by IP, adding 2FA, or using a custom login URL.',
        url: wpLogin,
      });
    }

    // Theme/plugin version in ?ver= param (already extracted by fingerprint, just note it here)
    const versionedAsset = requests.find(r => /[?&]ver=[\d.]+/.test(r.url));
    if (versionedAsset) {
      const match = versionedAsset.url.match(/[?&]ver=([\d.]+)/);
      findings.push({
        cms: 'WordPress',
        severity: 'low',
        finding: `Component version disclosed via ?ver= parameter`,
        detail: `Asset URL exposes version "${match?.[1]}" — allows attackers to target known CVEs for that version.`,
        url: versionedAsset.url.slice(0, 120),
      });
    }
  }

  if (cms === 'Drupal') {
    const changelogUrl = urls.find(u => /CHANGELOG\.txt|\/INSTALL\.txt/i.test(u));
    if (changelogUrl) {
      findings.push({
        cms: 'Drupal',
        severity: 'medium',
        finding: 'Drupal version disclosure file accessible',
        detail: 'CHANGELOG.txt or INSTALL.txt exposes the exact Drupal version.',
        url: changelogUrl,
      });
    }
  }

  return findings;
}

export function fingerprintTechnologies(
  requests: NetworkRequest[],
  targetUrl: string,
): FingerprintReport {
  const targetHost = new URL(targetUrl).hostname;
  const found = new Map<string, TechSignature>();
  const thirdPartyMap = new Map<string, { count: number; bytes: number }>();

  let serverSoftware: string | null = null;
  let poweredBy: string | null = null;

  for (const req of requests) {
    // Third-party domain tracking
    try {
      const reqHost = new URL(req.url).hostname;
      if (reqHost !== targetHost && !reqHost.endsWith('.' + targetHost)) {
        const existing = thirdPartyMap.get(reqHost) ?? { count: 0, bytes: 0 };
        thirdPartyMap.set(reqHost, {
          count: existing.count + 1,
          bytes: existing.bytes + req.sizeBytes,
        });
      }
    } catch { /* skip invalid URLs */ }

    const lh = Object.fromEntries(
      Object.entries(req.responseHeaders).map(([k, v]) => [k.toLowerCase(), v])
    );

    if (lh['server'] && !serverSoftware) serverSoftware = lh['server'];
    if (lh['x-powered-by'] && !poweredBy) poweredBy = lh['x-powered-by'];

    // Header-based detection
    for (const sig of HEADER_SIGNATURES) {
      const val = lh[sig.header];
      if (!val) continue;
      const match = val.match(sig.pattern);
      if (match && !found.has(sig.name)) {
        found.set(sig.name, {
          name: sig.name,
          category: sig.category,
          confidence: sig.confidence,
          version: match[1] ?? undefined,
          evidence: `${sig.header}: ${val.slice(0, 60)}`,
        });
      }
    }

    // URL-based detection — with version extraction
    for (const sig of URL_SIGNATURES) {
      const match = req.url.match(sig.pattern);
      if (match) {
        const existing = found.get(sig.name);
        // Upgrade confidence if we now have a version and didn't before
        const version = sig.versionGroup ? (match[sig.versionGroup] ?? undefined) : undefined;
        if (!existing) {
          found.set(sig.name, {
            name: sig.name,
            category: sig.category,
            confidence: sig.confidence,
            version,
            evidence: `URL: ${req.url.slice(0, 100)}`,
          });
        } else if (version && !existing.version) {
          // Enrich existing entry with version info
          found.set(sig.name, { ...existing, version });
        }
      }
    }
  }

  const technologies = Array.from(found.values()).sort((a, b) =>
    a.category.localeCompare(b.category)
  );

  const thirdPartyDomains: ThirdPartyDomain[] = Array.from(thirdPartyMap.entries())
    .map(([domain, { count, bytes }]) => ({
      domain,
      requestCount: count,
      totalBytes: bytes,
      category: categorizeThirdParty(domain),
    }))
    .sort((a, b) => b.requestCount - a.requestCount);

  // Detect CMS-specific attack surface for every CMS we found
  const detectedCms = technologies
    .filter(t => t.category === 'cms')
    .map(t => t.name);

  const cmsExposure: CmsExposureFinding[] = [];
  for (const cms of detectedCms) {
    cmsExposure.push(...detectCmsExposure(cms, requests, targetHost));
  }

  return { technologies, serverSoftware, poweredBy, thirdPartyDomains, cmsExposure };
}

import { chromium, type BrowserContext, type Request, type Response, type Page } from 'playwright';
import type { NetworkRequest, CaptureOptions, CaptureResult, ResourceType, DiscoveredForm } from './types.js';

// Cap how much of any response body we read into memory / store as a sample.
const MAX_BODY_SAMPLE_BYTES = 256 * 1024; // 256 KB

// Asset extensions we skip when spidering — no security value crawling images/fonts.
const SKIP_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|ico|webp|avif|css|woff|woff2|ttf|eot|mp4|webm|mp3|pdf|zip|gz|tar|exe|dmg|pkg)(\?|$)/i;

// URL schemes we can't navigate.
const SKIP_SCHEMES = /^(mailto:|tel:|javascript:|#|data:)/i;

function isTextual(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return /text\/|json|javascript|xml|html|csv|x-www-form-urlencoded/i.test(contentType);
}

const PLAYWRIGHT_TYPE_MAP: Record<string, ResourceType> = {
  document: 'document',
  script: 'script',
  stylesheet: 'stylesheet',
  image: 'image',
  xhr: 'xhr',
  fetch: 'fetch',
  font: 'font',
  media: 'media',
  websocket: 'other',
  manifest: 'other',
  other: 'other',
  eventsource: 'other',
  texttrack: 'other',
  ping: 'other',
  cspviolationreport: 'other',
  preflight: 'other',
};

interface TimingData {
  startTime: number;
  ttfbMs: number;
  durationMs: number;
}

export function mapRequest(
  req: { url: () => string; method: () => string; resourceType: () => string; headers: () => Record<string, string> },
  resp: { status: () => number; headers: () => Record<string, string>; body: () => Promise<Buffer> } | null,
  timing: TimingData,
  errorText?: string
): NetworkRequest {
  const resourceType: ResourceType = PLAYWRIGHT_TYPE_MAP[req.resourceType()] ?? 'other';

  if (!resp || errorText) {
    return {
      url: req.url(),
      method: req.method(),
      resourceType,
      statusCode: null,
      sizeBytes: 0,
      ttfbMs: timing.ttfbMs,
      durationMs: timing.durationMs,
      requestHeaders: req.headers(),
      responseHeaders: {},
      failed: true,
      errorText: errorText ?? 'Request failed',
    };
  }

  return {
    url: req.url(),
    method: req.method(),
    resourceType,
    statusCode: resp.status(),
    sizeBytes: 0,
    ttfbMs: timing.ttfbMs,
    durationMs: timing.durationMs,
    requestHeaders: req.headers(),
    responseHeaders: resp.headers(),
    failed: false,
  };
}

// ── Capture all network traffic from a single page load ───────────────────────

async function capturePage(
  context: BrowserContext,
  url: string,
  timeoutMs: number,
): Promise<{ requests: NetworkRequest[]; links: string[]; forms: DiscoveredForm[] }> {
  const page = await context.newPage();

  const requestMap = new Map<Request, { startTime: number; response: Response | null; errorText?: string }>();
  const finishedRequests: NetworkRequest[] = [];

  page.on('request', (req) => {
    requestMap.set(req, { startTime: Date.now(), response: null });
  });

  page.on('response', (resp) => {
    const entry = requestMap.get(resp.request());
    if (entry) entry.response = resp;
  });

  page.on('requestfinished', async (req) => {
    const entry = requestMap.get(req);
    if (!entry) return;
    const timing = req.timing();
    const ttfbMs = timing.responseStart >= 0 ? timing.responseStart : 0;
    const durationMs = timing.responseEnd >= 0 ? timing.responseEnd : Date.now() - entry.startTime;

    let sizeBytes = 0;
    let responseBodySample: string | undefined;
    try {
      const resp = await req.response();
      const contentLength = Number(resp?.headers()['content-length'] ?? NaN);
      if (Number.isFinite(contentLength) && contentLength >= 0) {
        sizeBytes = contentLength;
        if (contentLength > 0 && contentLength <= MAX_BODY_SAMPLE_BYTES && isTextual(resp?.headers()['content-type'])) {
          const body = await resp?.body();
          sizeBytes = body?.length ?? contentLength;
          responseBodySample = body?.toString('utf8').slice(0, MAX_BODY_SAMPLE_BYTES);
        }
      } else {
        const body = await resp?.body();
        const buf = body ?? Buffer.alloc(0);
        sizeBytes = buf.length;
        if (isTextual(resp?.headers()['content-type'])) {
          responseBodySample = buf.toString('utf8').slice(0, MAX_BODY_SAMPLE_BYTES);
        }
      }
    } catch { /* ignore */ }

    let requestBody: string | undefined;
    try {
      const pd = req.postData();
      if (pd) requestBody = pd.slice(0, MAX_BODY_SAMPLE_BYTES);
    } catch { /* no post data */ }

    let requestHeaders = req.headers();
    let responseHeaders: Record<string, string> = entry.response?.headers() ?? {};
    try {
      requestHeaders = await req.allHeaders();
      const resp = await req.response();
      if (resp) responseHeaders = await resp.allHeaders();
    } catch { /* keep sync fallback */ }

    const mapped = mapRequest(req, entry.response, { startTime: entry.startTime, ttfbMs, durationMs });
    finishedRequests.push({ ...mapped, requestHeaders, responseHeaders, sizeBytes, requestBody, responseBodySample });
  });

  page.on('requestfailed', (req) => {
    const entry = requestMap.get(req);
    if (!entry) return;
    const durationMs = Date.now() - entry.startTime;
    const errorText = req.failure()?.errorText ?? 'Request failed';
    const mapped = mapRequest(req, null, { startTime: entry.startTime, ttfbMs: 0, durationMs }, errorText);
    finishedRequests.push(mapped);
  });

  // Navigate — try networkidle, fall back to domcontentloaded for heavy SPAs
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    if (isTimeout) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await page.waitForTimeout(3000);
      } catch { /* collect whatever we got */ }
    } else {
      await page.close();
      throw err;
    }
  }

  // ── Extract links for spidering ──────────────────────────────────────────────
  const links: string[] = [];
  try {
    const hrefs = await page.$$eval('a[href]', (els) =>
      els.map((el) => (el as HTMLAnchorElement).href).filter(Boolean)
    );
    links.push(...hrefs);
  } catch { /* page may have already navigated */ }

  // ── Extract forms ────────────────────────────────────────────────────────────
  const forms: DiscoveredForm[] = [];
  try {
    const rawForms = await page.$$eval('form', (formEls) =>
      formEls.map((f) => {
        const action = (f as HTMLFormElement).action || '';
        const method = ((f as HTMLFormElement).method || 'GET').toUpperCase();
        const fields = Array.from(f.querySelectorAll('input, select, textarea')).map((el) => ({
          name: (el as HTMLInputElement).name || '',
          type: (el as HTMLInputElement).type || 'text',
          value: (el as HTMLInputElement).value || '',
        })).filter((field) => field.name);
        return { action, method, fields };
      })
    );

    for (const raw of rawForms) {
      // Resolve action relative to page URL
      let action = raw.action;
      try {
        action = new URL(raw.action || url, url).href;
      } catch { action = url; }

      forms.push({
        pageUrl: url,
        action,
        method: (raw.method === 'POST' ? 'POST' : 'GET') as 'GET' | 'POST',
        fields: raw.fields,
      });
    }
  } catch { /* ignore form extraction errors */ }

  await page.close();
  return { requests: finishedRequests, links, forms };
}

// ── Main export: captureNetwork with optional BFS spider ──────────────────────

export async function captureNetwork(options: CaptureOptions): Promise<CaptureResult> {
  const {
    url,
    timeoutMs = 30000,
    maxPages = 1,
    sameOriginOnly = true,
  } = options;

  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      // Ignore HTTPS errors on target — we're testing it, not trusting it
      ignoreHTTPSErrors: true,
      // Realistic UA so sites don't serve a simplified bot page
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const captureTimestamp = new Date().toISOString();
    const overallStart = Date.now();

    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      origin = url;
    }

    // BFS state
    const queue: string[] = [url];
    const visited = new Set<string>();
    const allRequests: NetworkRequest[] = [];
    const allForms: DiscoveredForm[] = [];
    const discoveredUrls: string[] = [];

    // Per-page timeout is shorter so we don't blow the whole scan on one slow page
    const perPageTimeout = Math.min(timeoutMs, 20000);

    while (queue.length > 0 && visited.size < maxPages) {
      const pageUrl = queue.shift()!;

      // Normalise — strip fragment, canonicalise trailing slash
      let canonical: string;
      try {
        const u = new URL(pageUrl);
        u.hash = '';
        canonical = u.href;
      } catch {
        continue;
      }

      if (visited.has(canonical)) continue;
      visited.add(canonical);
      discoveredUrls.push(canonical);

      let pageResult: Awaited<ReturnType<typeof capturePage>>;
      try {
        pageResult = await capturePage(context, canonical, perPageTimeout);
      } catch {
        continue; // unreachable / error page — skip and keep spidering
      }

      allRequests.push(...pageResult.requests);
      allForms.push(...pageResult.forms);

      // Enqueue discovered links if we still have budget
      if (visited.size < maxPages) {
        for (const href of pageResult.links) {
          // Skip non-http, assets, fragments-only
          if (SKIP_SCHEMES.test(href)) continue;
          if (SKIP_EXTENSIONS.test(href)) continue;

          let linkUrl: URL;
          try {
            linkUrl = new URL(href);
          } catch {
            continue;
          }

          // Same-origin filter
          if (sameOriginOnly && linkUrl.origin !== origin) continue;

          // Strip fragment before dedup check
          linkUrl.hash = '';
          const normalized = linkUrl.href;

          if (!visited.has(normalized) && !queue.includes(normalized)) {
            queue.push(normalized);
          }
        }
      }
    }

    await context.close();

    // Deduplicate requests by url+method (same endpoint hit on multiple pages
    // should only be analyzed once by the vuln scanner)
    const seen = new Set<string>();
    const dedupedRequests = allRequests.filter((r) => {
      const key = `${r.method}:${r.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      requests: dedupedRequests,
      captureTimestamp,
      totalDurationMs: Date.now() - overallStart,
      discoveredUrls,
      forms: allForms,
    };
  } finally {
    await browser.close();
  }
}

import { chromium, type Request, type Response } from 'playwright';
import type { NetworkRequest, CaptureOptions, CaptureResult, ResourceType } from './types.js';

// Cap how much of any response body we read into memory / store as a sample.
// Protects against multi-hundred-MB media or downloads exhausting memory.
const MAX_BODY_SAMPLE_BYTES = 256 * 1024; // 256 KB

// Only sample bodies for textual content types worth analyzing.
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
    sizeBytes: 0, // populated after body is read
    ttfbMs: timing.ttfbMs,
    durationMs: timing.durationMs,
    requestHeaders: req.headers(),
    responseHeaders: resp.headers(),
    failed: false,
  };
}

export async function captureNetwork(options: CaptureOptions): Promise<CaptureResult> {
  const { url, timeoutMs = 30000 } = options;
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
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
      // Prefer Playwright's own timing for both TTFB and duration so the two
      // numbers come from the same clock. Fall back to wall-clock if unavailable.
      const ttfbMs = timing.responseStart >= 0 ? timing.responseStart : 0;
      const durationMs = timing.responseEnd >= 0
        ? timing.responseEnd
        : Date.now() - entry.startTime;

      // Measure size from Content-Length when present; only read the body when
      // we must, and cap the read so large media/downloads can't exhaust memory.
      let sizeBytes = 0;
      let responseBodySample: string | undefined;
      try {
        const resp = await req.response();
        const contentLength = Number(resp?.headers()['content-length'] ?? NaN);
        if (Number.isFinite(contentLength) && contentLength >= 0) {
          sizeBytes = contentLength;
          // Still grab a small text sample for passive analysis on textual types
          if (contentLength > 0 && contentLength <= MAX_BODY_SAMPLE_BYTES && isTextual(resp?.headers()['content-type'])) {
            const body = await resp?.body();
            sizeBytes = body?.length ?? contentLength;
            responseBodySample = body?.toString('utf8').slice(0, MAX_BODY_SAMPLE_BYTES);
          }
        } else {
          // No Content-Length — read with a cap
          const body = await resp?.body();
          const buf = body ?? Buffer.alloc(0);
          sizeBytes = buf.length;
          if (isTextual(resp?.headers()['content-type'])) {
            responseBodySample = buf.toString('utf8').slice(0, MAX_BODY_SAMPLE_BYTES);
          }
        }
      } catch { /* ignore body read errors */ }

      let requestBody: string | undefined;
      try {
        const pd = req.postData();
        if (pd) requestBody = pd.slice(0, MAX_BODY_SAMPLE_BYTES);
      } catch { /* no post data */ }

      // IMPORTANT: Playwright's sync `headers()` strips cookie-related headers
      // (Set-Cookie, Cookie). The async `allHeaders()` returns the complete set,
      // which the cookie/auth analyzers depend on. Fall back to the sync headers
      // if the async call fails for any reason.
      let requestHeaders = req.headers();
      let responseHeaders: Record<string, string> = entry.response?.headers() ?? {};
      try {
        requestHeaders = await req.allHeaders();
        const resp = await req.response();
        if (resp) responseHeaders = await resp.allHeaders();
      } catch { /* keep the sync-header fallback */ }

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

    const captureTimestamp = new Date().toISOString();
    const pageStart = Date.now();

    // Try networkidle first; heavy SPAs that keep polling will never go idle,
    // so fall back to domcontentloaded + a short extra wait to catch initial requests.
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      if (isTimeout) {
        // Page never went idle — wait for DOM ready instead and collect what we have
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
          // Give it a few extra seconds to capture XHR/fetch after DOM load
          await page.waitForTimeout(3000);
        } catch {
          // If even domcontentloaded fails, return whatever was captured so far
        }
      } else {
        throw err;
      }
    }

    const totalDurationMs = Date.now() - pageStart;
    await context.close();

    return { requests: finishedRequests, captureTimestamp, totalDurationMs };
  } finally {
    await browser.close();
  }
}

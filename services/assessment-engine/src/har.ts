import type { NetworkRequest, HarFile, HarEntry, ResourceType } from './types.js';

const CREATOR = { name: 'astra', version: '1.0.0' };

function headersToHar(headers: Record<string, string>): Array<{ name: string; value: string }> {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function headersFromHar(headers: Array<{ name: string; value: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const { name, value } of headers) result[name] = value;
  return result;
}

export function generateHar(requests: NetworkRequest[], captureTimestamp: string): HarFile {
  const entries: HarEntry[] = requests.map((r) => ({
    startedDateTime: captureTimestamp,
    time: r.durationMs,
    _resourceType: r.resourceType,
    request: {
      method: r.method,
      url: r.url,
      headers: headersToHar(r.requestHeaders),
      bodySize: -1,
    },
    response: {
      status: r.statusCode ?? 0,
      headers: headersToHar(r.responseHeaders),
      content: { size: r.sizeBytes, mimeType: r.responseHeaders['content-type'] ?? r.responseHeaders['Content-Type'] ?? '' },
      bodySize: r.sizeBytes,
    },
    timings: {
      wait: r.ttfbMs,
      receive: Math.max(0, r.durationMs - r.ttfbMs),
    },
  }));

  return { log: { version: '1.2', creator: CREATOR, entries } };
}

const VALID_RESOURCE_TYPES = new Set<ResourceType>([
  'document', 'script', 'stylesheet', 'image', 'xhr', 'fetch', 'font', 'media', 'other',
]);

export function parseHar(json: string): NetworkRequest[] {
  const har: HarFile = JSON.parse(json);
  return har.log.entries.map((entry) => {
    const statusCode = entry.response.status === 0 ? null : entry.response.status;
    const failed = statusCode === null;
    // Restore resourceType from our custom field; fall back to 'other'
    const rt = entry._resourceType as ResourceType | undefined;
    const resourceType: ResourceType = rt && VALID_RESOURCE_TYPES.has(rt) ? rt : 'other';
    return {
      url: entry.request.url,
      method: entry.request.method,
      resourceType,
      statusCode,
      sizeBytes: entry.response.content.size,
      ttfbMs: entry.timings.wait,
      durationMs: entry.time,
      requestHeaders: headersFromHar(entry.request.headers),
      responseHeaders: headersFromHar(entry.response.headers),
      failed,
    };
  });
}

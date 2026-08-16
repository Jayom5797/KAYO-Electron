export type ResourceType =
  | 'document'
  | 'script'
  | 'stylesheet'
  | 'image'
  | 'xhr'
  | 'fetch'
  | 'font'
  | 'media'
  | 'other';

export interface NetworkRequest {
  url: string;
  method: string;
  resourceType: ResourceType;
  statusCode: number | null;
  sizeBytes: number;
  ttfbMs: number;
  durationMs: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  failed: boolean;
  errorText?: string;
  /** Request body / POST data, if any (bounded). */
  requestBody?: string;
  /** Bounded sample of the response body for passive analysis. */
  responseBodySample?: string;
}

export interface CaptureOptions {
  url: string;
  timeoutMs: number;
}

export interface CaptureResult {
  requests: NetworkRequest[];
  captureTimestamp: string; // ISO 8601
  totalDurationMs: number;
}

export interface AggregateMetrics {
  totalRequests: number;
  totalBytes: number;
  totalDurationMs: number;
}

export interface TypeMetrics {
  resourceType: ResourceType;
  count: number;
  totalBytes: number;
  avgDurationMs: number;
}

export interface ProcessedData {
  requests: NetworkRequest[];
  aggregate: AggregateMetrics;
  byType: TypeMetrics[];
  slowest: NetworkRequest[]; // top 5 by durationMs
  errors: NetworkRequest[];  // statusCode >= 400 or failed === true
}

export interface ReportInput {
  url: string;
  captureTimestamp: string;
  totalDurationMs: number;
  data: ProcessedData;
}

export interface HarEntry {
  startedDateTime: string; // ISO 8601
  time: number;            // total duration ms
  _resourceType?: string;  // custom field — preserves our ResourceType across round-trip
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    bodySize: number;
  };
  response: {
    status: number;
    headers: Array<{ name: string; value: string }>;
    content: { size: number; mimeType: string };
    bodySize: number;
  };
  timings: {
    wait: number;    // TTFB
    receive: number; // durationMs - ttfbMs
  };
}

export interface HarFile {
  log: {
    version: '1.2';
    creator: { name: string; version: string };
    entries: HarEntry[];
  };
}

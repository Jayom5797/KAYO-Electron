import * as fc from 'fast-check';
import type { NetworkRequest, ResourceType } from '../types.js';

const RESOURCE_TYPES: ResourceType[] = [
  'document', 'script', 'stylesheet', 'image',
  'xhr', 'fetch', 'font', 'media', 'other',
];

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

const SCHEMES = ['https://', 'http://'];

const DOMAINS = [
  'example.com', 'cdn.example.com', 'api.example.com',
  'static.example.org', 'assets.example.net',
];

const PATHS = [
  '/', '/index.html', '/app.js', '/styles.css',
  '/api/data', '/images/logo.png', '/fonts/roboto.woff2',
];

/** Generates a realistic-looking URL string */
const urlArbitrary = (): fc.Arbitrary<string> =>
  fc.record({
    scheme: fc.constantFrom(...SCHEMES),
    domain: fc.constantFrom(...DOMAINS),
    path: fc.constantFrom(...PATHS),
  }).map(({ scheme, domain, path }) => `${scheme}${domain}${path}`);

/** Generates a flat Record<string, string> of HTTP headers */
const headersArbitrary = (): fc.Arbitrary<Record<string, string>> =>
  fc.dictionary(
    fc.constantFrom(
      'content-type', 'content-length', 'cache-control',
      'accept', 'accept-encoding', 'authorization',
      'x-request-id', 'etag', 'last-modified',
    ),
    fc.string({ minLength: 1, maxLength: 64 }),
    { minKeys: 0, maxKeys: 5 },
  );

/**
 * Shared fast-check arbitrary for generating valid NetworkRequest objects
 * with realistic field distributions.
 *
 * Used across all property-based tests in the network-tab-analyzer suite.
 */
export function networkRequestArbitrary(): fc.Arbitrary<NetworkRequest> {
  return fc.record({
    url: urlArbitrary(),
    method: fc.constantFrom(...HTTP_METHODS),
    resourceType: fc.constantFrom(...RESOURCE_TYPES),
    // Mix of successful (numeric status) and failed (null) requests
    statusCode: fc.oneof(
      fc.constantFrom(200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 500, 502, 503),
      fc.constant(null),
    ),
    sizeBytes: fc.integer({ min: 0, max: 10_000_000 }),
    ttfbMs: fc.float({ min: 0, max: 5000, noNaN: true }),
    durationMs: fc.float({ min: 0, max: 10000, noNaN: true }),
    requestHeaders: headersArbitrary(),
    responseHeaders: headersArbitrary(),
    failed: fc.boolean(),
  }).chain((req) => {
    // Ensure consistency: if statusCode is null, failed should be true;
    // if failed is true, errorText should be present.
    if (req.statusCode === null) {
      return fc.constant({
        ...req,
        failed: true,
        errorText: 'net::ERR_CONNECTION_REFUSED',
      });
    }
    if (req.failed) {
      return fc.constant({
        ...req,
        statusCode: null,
        errorText: 'net::ERR_FAILED',
      });
    }
    return fc.constant(req);
  });
}

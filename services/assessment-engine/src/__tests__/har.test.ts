import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { generateHar, parseHar } from '../har.js';
import { networkRequestArbitrary } from './arbitraries.js';

// Feature: network-tab-analyzer, Property 11: HAR structure validity
describe('Property 11: HAR structure validity', () => {
  it('generateHar returns valid HAR 1.2 structure with correct entry count', () => {
    fc.assert(
      fc.property(fc.array(networkRequestArbitrary()), (requests) => {
        const har = generateHar(requests, new Date().toISOString());
        if (har.log.version !== '1.2') return false;
        if (har.log.entries.length !== requests.length) return false;
        return har.log.entries.every(
          (e) =>
            e.request !== undefined &&
            e.response !== undefined &&
            e.timings !== undefined &&
            typeof e.time === 'number'
        );
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: network-tab-analyzer, Property 12: HAR round-trip
describe('Property 12: HAR round-trip', () => {
  it('serialize → parse → serialize → parse produces equivalent entries', () => {
    fc.assert(
      fc.property(fc.array(networkRequestArbitrary()), (requests) => {
        const ts = new Date().toISOString();
        const har1 = generateHar(requests, ts);
        const parsed1 = parseHar(JSON.stringify(har1));
        const har2 = generateHar(parsed1, ts);
        const parsed2 = parseHar(JSON.stringify(har2));
        if (parsed1.length !== parsed2.length) return false;
        return parsed1.every((r, i) => {
          const r2 = parsed2[i];
          return (
            r.url === r2.url &&
            r.method === r2.method &&
            r.sizeBytes === r2.sizeBytes &&
            r.ttfbMs === r2.ttfbMs &&
            r.durationMs === r2.durationMs
          );
        });
      }),
      { numRuns: 100 }
    );
  });
});

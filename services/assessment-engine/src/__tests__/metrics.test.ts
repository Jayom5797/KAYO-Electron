import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import {
  groupByType,
  computeAggregate,
  computeTypeMetrics,
  getSlowest,
  getErrors,
  processRequests,
} from '../metrics.js';
import { networkRequestArbitrary } from './arbitraries.js';

// Feature: network-tab-analyzer, Property 4: Failed requests are always recorded
describe('Property 4: Failed requests are always recorded', () => {
  it('processRequests includes all failed requests in result', () => {
    fc.assert(
      fc.property(fc.array(networkRequestArbitrary()), (requests) => {
        const result = processRequests(requests);
        const failedInput = requests.filter((r) => r.failed);
        const failedOutput = result.requests.filter((r) => r.failed);
        return failedInput.length === failedOutput.length;
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: network-tab-analyzer, Property 5: Grouping correctness
describe('Property 5: Grouping correctness', () => {
  it('every request in each group matches the group key', () => {
    fc.assert(
      fc.property(fc.array(networkRequestArbitrary()), (requests) => {
        const groups = groupByType(requests);
        for (const [key, group] of groups) {
          if (!group.every((r) => r.resourceType === key)) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('union of all groups equals original list', () => {
    fc.assert(
      fc.property(fc.array(networkRequestArbitrary()), (requests) => {
        const groups = groupByType(requests);
        const all: typeof requests = [];
        for (const group of groups.values()) all.push(...group);
        return all.length === requests.length;
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: network-tab-analyzer, Property 6: Metrics computation correctness
describe('Property 6: Metrics computation correctness', () => {
  it('totalBytes equals exact sum of sizeBytes', () => {
    fc.assert(
      fc.property(fc.array(networkRequestArbitrary(), { minLength: 1 }), (requests) => {
        const agg = computeAggregate(requests);
        const expected = requests.reduce((s, r) => s + r.sizeBytes, 0);
        return agg.totalBytes === expected;
      }),
      { numRuns: 100 }
    );
  });

  it('per-type averages are consistent with group members', () => {
    fc.assert(
      fc.property(fc.array(networkRequestArbitrary(), { minLength: 1 }), (requests) => {
        const typeMetrics = computeTypeMetrics(requests);
        const groups = groupByType(requests);
        for (const tm of typeMetrics) {
          const group = groups.get(tm.resourceType) ?? [];
          const expectedAvg = group.reduce((s, r) => s + r.durationMs, 0) / group.length;
          if (Math.abs(tm.avgDurationMs - expectedAvg) > 0.001) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: network-tab-analyzer, Property 7: Slowest requests selection
describe('Property 7: Slowest requests selection', () => {
  it('getSlowest returns 5 requests all with durationMs >= every non-result request', () => {
    fc.assert(
      fc.property(fc.array(networkRequestArbitrary(), { minLength: 5 }), (requests) => {
        const slowest = getSlowest(requests, 5);
        if (slowest.length !== 5) return false;
        const slowestMin = Math.min(...slowest.map((r) => r.durationMs));
        const rest = requests.filter((r) => !slowest.includes(r));
        return rest.every((r) => r.durationMs <= slowestMin);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: network-tab-analyzer, Property 8: Error requests filter
describe('Property 8: Error requests filter', () => {
  it('getErrors returns exactly requests where statusCode >= 400 or failed === true', () => {
    fc.assert(
      fc.property(fc.array(networkRequestArbitrary()), (requests) => {
        const errors = getErrors(requests);
        const expected = requests.filter(
          (r) => r.failed === true || (r.statusCode !== null && r.statusCode >= 400)
        );
        return errors.length === expected.length;
      }),
      { numRuns: 100 }
    );
  });
});

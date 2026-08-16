import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { renderReport, formatBytes, truncateUrl } from '../report.js';
import { networkRequestArbitrary } from './arbitraries.js';
import { processRequests } from '../metrics.js';
import type { ReportInput } from '../types.js';

function makeReportInput(overrides: Partial<ReportInput> = {}): fc.Arbitrary<ReportInput> {
  return fc.array(networkRequestArbitrary(), { minLength: 1 }).map((requests) => ({
    url: 'https://example.com',
    captureTimestamp: new Date().toISOString(),
    totalDurationMs: 1234,
    data: processRequests(requests),
    ...overrides,
  }));
}

// Feature: network-tab-analyzer, Property 9: Report structure completeness
describe('Property 9: Report structure completeness', () => {
  it('rendered report contains all five section headings in order', () => {
    fc.assert(
      fc.property(makeReportInput(), (input) => {
        const report = renderReport(input);
        const sections = ['## Summary', '## Request Breakdown by Type', '## Slowest Requests', '## Errors and Failed Requests', '## Full Request Log'];
        let lastIdx = -1;
        for (const section of sections) {
          const idx = report.indexOf(section);
          if (idx === -1 || idx <= lastIdx) return false;
          lastIdx = idx;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('Summary section contains URL, timestamp, count, bytes, duration', () => {
    fc.assert(
      fc.property(makeReportInput(), (input) => {
        const report = renderReport(input);
        return (
          report.includes(input.url) &&
          report.includes(input.captureTimestamp) &&
          report.includes(String(input.data.aggregate.totalRequests))
        );
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: network-tab-analyzer, Property 10: Full request log completeness
describe('Property 10: Full request log completeness', () => {
  it('every request URL (truncated to 80 chars) appears in Full Request Log', () => {
    fc.assert(
      fc.property(fc.array(networkRequestArbitrary(), { minLength: 1 }), (requests) => {
        const input: ReportInput = {
          url: 'https://example.com',
          captureTimestamp: new Date().toISOString(),
          totalDurationMs: 500,
          data: processRequests(requests),
        };
        const report = renderReport(input);
        const logSection = report.split('## Full Request Log')[1] ?? '';
        return requests.every((r) => logSection.includes(truncateUrl(r.url)));
      }),
      { numRuns: 100 }
    );
  });
});

describe('formatBytes', () => {
  it('0 bytes', () => expect(formatBytes(0)).toBe('0 B'));
  it('999 bytes', () => expect(formatBytes(999)).toBe('999 B'));
  it('1024 bytes = 1.0 KB', () => expect(formatBytes(1024)).toBe('1.0 KB'));
  it('1048576 bytes = 1.0 MB', () => expect(formatBytes(1048576)).toBe('1.0 MB'));
});

describe('truncateUrl', () => {
  it('URL shorter than 80 chars unchanged', () => {
    const url = 'https://example.com/short';
    expect(truncateUrl(url)).toBe(url);
  });
  it('URL exactly 80 chars unchanged', () => {
    const url = 'a'.repeat(80);
    expect(truncateUrl(url)).toBe(url);
  });
  it('URL longer than 80 chars gets truncated with ellipsis', () => {
    const url = 'a'.repeat(100);
    const result = truncateUrl(url);
    expect(result.length).toBe(80);
    expect(result.endsWith('…')).toBe(true);
  });
});

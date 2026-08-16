import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeUrl, validateUrl, normalizeAndValidate } from '../url.js';

// Feature: network-tab-analyzer, Property 1: URL scheme normalization
describe('Property 1: URL scheme normalization', () => {
  it('normalizeUrl always prepends https:// when no scheme present', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes('://')),
        (input) => {
          const result = normalizeUrl(input);
          return result === `https://${input}`;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: network-tab-analyzer, Property 2: URL validation rejects all invalid inputs
describe('Property 2: URL validation rejects all invalid inputs', () => {
  it('validateUrl rejects structurally invalid strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => {
          try { new URL(s); return false; } catch { return true; }
        }),
        (invalid) => {
          const result = validateUrl(invalid);
          return result.ok === false;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('validateUrl rejects non-http/https schemes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('ftp', 'file', 'ws', 'wss', 'mailto', 'data', 'blob')
          .map((scheme) => `${scheme}://example.com`),
        (url) => {
          const result = validateUrl(url);
          return result.ok === false;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('normalizeUrl', () => {
  it('prepends https:// to a bare domain', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com');
  });
  it('leaves http:// prefix unchanged', () => {
    expect(normalizeUrl('http://example.com')).toBe('http://example.com');
  });
  it('leaves https:// prefix unchanged', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
  });
});

describe('normalizeAndValidate', () => {
  it('bare domain resolves to ok with https:// prepended', () => {
    expect(normalizeAndValidate('example.com')).toEqual({ ok: true, url: 'https://example.com' });
  });
  it('http:// URL passes through', () => {
    expect(normalizeAndValidate('http://example.com')).toEqual({ ok: true, url: 'http://example.com' });
  });
  it('https:// URL passes through', () => {
    expect(normalizeAndValidate('https://example.com')).toEqual({ ok: true, url: 'https://example.com' });
  });
  it('structurally invalid string returns ok: false', () => {
    const result = normalizeAndValidate('not a url!!!');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid url/i);
  });
  it('ftp:// scheme returns ok: false', () => {
    const result = normalizeAndValidate('ftp://example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ftp/i);
  });
  it('file:// scheme returns ok: false', () => {
    const result = normalizeAndValidate('file:///etc/passwd');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/file/i);
  });
  it('ws:// scheme returns ok: false', () => {
    const result = normalizeAndValidate('ws://example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ws/i);
  });
});

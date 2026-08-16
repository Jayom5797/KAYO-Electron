import { describe, it, expect } from 'vitest';
import { detectXssContext } from '../security/vulnScanner.js';

// detectXssContext is the highest-false-positive-risk logic in the active
// scanner: it decides whether a reflected payload is actually exploitable.
// These tests lock in both the true positives and the guards against noise.
describe('detectXssContext', () => {
  it('returns null when the payload is not reflected at all', () => {
    expect(detectXssContext('<p>nothing here</p>', '<script>alert(1)</script>')).toBeNull();
  });

  it('returns null when the payload is HTML-encoded (safely reflected)', () => {
    const body = '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>';
    expect(detectXssContext(body, '<script>alert(1)</script>')).toBeNull();
  });

  it('returns null when the reflection sits inside an HTML comment', () => {
    const body = '<!-- debug: <script>alert(1)</script> -->';
    expect(detectXssContext(body, '<script>alert(1)</script>')).toBeNull();
  });

  it('detects reflection inside a <script> block as script-context', () => {
    const body = '<script>var q = "foo INJECTED bar";</script>';
    expect(detectXssContext(body, 'INJECTED')).toBe('script-context');
  });

  it('detects an unencoded <script> tag injection as html-injection', () => {
    const body = '<div>results for <script>alert(1)</script></div>';
    expect(detectXssContext(body, '<script>alert(1)</script>')).toBe('html-injection');
  });

  it('detects an unencoded event-handler injection as attribute-injection', () => {
    const body = '<img src=x onerror=alert(1)> results';
    expect(detectXssContext(body, 'x onerror=alert(1)')).toBe('attribute-injection');
  });

  it('does not flag a plainly reflected value in normal HTML text', () => {
    const body = '<p>You searched for: hello</p>';
    expect(detectXssContext(body, 'hello')).toBeNull();
  });
});

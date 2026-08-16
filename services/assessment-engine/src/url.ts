export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Prepends `https://` if the input has no scheme (no `://` present).
 * Inputs that already carry any scheme (ftp://, ws://, etc.) are returned
 * unchanged so that validateUrl can reject them with a proper scheme error.
 */
export function normalizeUrl(input: string): string {
  if (input.includes('://')) {
    return input;
  }
  return `https://${input}`;
}

/**
 * Validates a (already-normalized) URL string.
 * Rejects structurally invalid URLs and non-http/https schemes.
 */
export function validateUrl(normalized: string): UrlValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { ok: false, error: `Invalid URL: "${normalized}" is not a valid URL` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: `Unsupported scheme "${parsed.protocol.replace(':', '')}": only HTTP and HTTPS URLs are supported`,
    };
  }

  return { ok: true, url: normalized };
}

/**
 * Normalizes then validates the input URL.
 */
export function normalizeAndValidate(input: string): UrlValidationResult {
  const normalized = normalizeUrl(input);
  return validateUrl(normalized);
}

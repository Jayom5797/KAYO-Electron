/**
 * SSRF Protection Module
 *
 * Validates URLs before they are passed to the headless browser or HTTP client.
 * Blocks access to:
 * - Private/internal IP ranges (RFC 1918, RFC 4193, loopback, link-local)
 * - Cloud metadata endpoints (AWS, GCP, Azure)
 * - Known dangerous protocols
 * - Extremely long URLs (DoS prevention)
 */

export interface SsrfValidation {
  safe: boolean;
  reason?: string;
}

// Private/reserved IP ranges (IPv4)
const PRIVATE_RANGES = [
  { start: '10.0.0.0', end: '10.255.255.255', label: 'RFC 1918 (10.x)' },
  { start: '172.16.0.0', end: '172.31.255.255', label: 'RFC 1918 (172.16-31.x)' },
  { start: '192.168.0.0', end: '192.168.255.255', label: 'RFC 1918 (192.168.x)' },
  { start: '127.0.0.0', end: '127.255.255.255', label: 'Loopback' },
  { start: '169.254.0.0', end: '169.254.255.255', label: 'Link-local' },
  { start: '0.0.0.0', end: '0.255.255.255', label: 'Current network' },
];

// Cloud metadata endpoints
const BLOCKED_HOSTS = [
  '169.254.169.254',       // AWS/GCP/Azure metadata
  'metadata.google.internal',
  'metadata.google.com',
  'metadata',
  'instance-data',
  '100.100.100.200',       // Alibaba Cloud metadata
  'fd00:ec2::254',         // AWS IPv6 metadata
];

// Blocked URL patterns (case insensitive)
const BLOCKED_PATTERNS = [
  /^file:/i,
  /^ftp:/i,
  /^gopher:/i,
  /^dict:/i,
  /^ldap:/i,
  /^data:/i,
  /^javascript:/i,
  /^jar:/i,
  /^netdoc:/i,
];

function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return -1;
  return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isPrivateIp(ip: string): { private: boolean; range?: string } {
  const ipLong = ipToLong(ip);
  if (ipLong === -1) return { private: false };

  for (const range of PRIVATE_RANGES) {
    const start = ipToLong(range.start);
    const end = ipToLong(range.end);
    if (ipLong >= start && ipLong <= end) {
      return { private: true, range: range.label };
    }
  }
  return { private: false };
}

/**
 * Validates a URL for SSRF safety.
 * Should be called before passing any URL to the headless browser or HTTP client.
 */
export function validateSsrf(rawUrl: string): SsrfValidation {
  // Length check (DoS prevention)
  if (rawUrl.length > 2048) {
    return { safe: false, reason: 'URL exceeds maximum length (2048 chars)' };
  }

  // Protocol check
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(rawUrl)) {
      return { safe: false, reason: `Blocked protocol: ${rawUrl.split(':')[0]}` };
    }
  }

  // Parse URL
  let parsed: URL;
  try {
    // Normalize: add https if no scheme
    const normalized = rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`;
    parsed = new URL(normalized);
  } catch {
    return { safe: false, reason: 'Invalid URL' };
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `Blocked protocol: ${parsed.protocol}` };
  }

  // Check hostname against blocked list
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.includes(hostname)) {
    return { safe: false, reason: `Blocked host: ${hostname} (cloud metadata endpoint)` };
  }

  // Check if hostname is an IP address
  const ipMatch = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
  if (ipMatch) {
    const check = isPrivateIp(hostname);
    if (check.private) {
      return { safe: false, reason: `Blocked: private IP range (${check.range})` };
    }
  }

  // Check for IPv6 loopback / private in bracket notation
  if (hostname === '[::1]' || hostname === '::1' || hostname.startsWith('[fc') || hostname.startsWith('[fd')) {
    return { safe: false, reason: 'Blocked: IPv6 loopback or private address' };
  }

  // Block localhost variants
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '0.0.0.0') {
    return { safe: false, reason: 'Blocked: localhost' };
  }

  // Block common internal hostnames
  const internalPatterns = ['internal', 'intranet', 'corp', 'private', 'local'];
  if (internalPatterns.some(p => hostname.includes(p)) && !hostname.includes('.com') && !hostname.includes('.io')) {
    return { safe: false, reason: `Potentially internal hostname: ${hostname}` };
  }

  // Check for DNS rebinding indicator (numeric TLDs that could be IPs)
  // This is a heuristic — full DNS resolution check would happen at network layer
  if (/^\d+\.\d+\.\d+\.\d+\./.test(hostname)) {
    return { safe: false, reason: 'Suspicious hostname format (possible IP obfuscation)' };
  }

  // Passed all checks
  return { safe: true };
}

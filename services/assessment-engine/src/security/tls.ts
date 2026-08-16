import * as tls from 'node:tls';
import * as https from 'node:https';
import * as http from 'node:http';

export interface TlsCertInfo {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysUntilExpiry: number;
  expired: boolean;
  selfSigned: boolean;
  serialNumber: string;
  fingerprint: string;
  subjectAltNames: string[];
}

export interface TlsInfo {
  protocol: string;
  cipher: string;
  cipherBits: number;
  cert: TlsCertInfo;
  hstsPresent: boolean;
  hstsMaxAge: number | null;
  hstsIncludeSubdomains: boolean;
  hstsPreload: boolean;
  httpRedirectsToHttps: boolean;
  grade: 'A+' | 'A' | 'B' | 'C' | 'F';
  issues: TlsIssue[];
}

export interface TlsIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  issue: string;
}

// Protocols considered broken — they floor the grade to C or below regardless of other factors
const BROKEN_PROTOCOLS = new Set(['TLSv1', 'TLSv1.1', 'SSLv3', 'SSLv2']);

// Weak cipher substrings — flag but don't fail outright
const WEAK_CIPHER_PATTERNS = [/RC4/i, /DES(?!-EDE)/i, /EXPORT/i, /NULL/i, /anon/i];

function computeGrade(issues: TlsIssue[]): TlsInfo['grade'] {
  // Grade is driven by the worst issue type, not issue count
  const hasCritical = issues.some(i => i.severity === 'critical');
  const hasHigh     = issues.some(i => i.severity === 'high');
  const hasMedium   = issues.some(i => i.severity === 'medium');
  const hasLow      = issues.some(i => i.severity === 'low');

  if (hasCritical) return 'F';        // expired cert, broken protocol, self-signed
  if (hasHigh)     return 'C';        // missing HSTS, weak cipher
  if (hasMedium)   return 'B';        // HSTS max-age too short, no includeSubDomains
  if (hasLow)      return 'A';        // missing preload only
  return 'A+';                        // nothing wrong
}

/** Check whether plain HTTP redirects to HTTPS */
function checkHttpRedirect(host: string, path: string): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.request(
      { host, port: 80, path: path || '/', method: 'HEAD' },
      res => {
        const location = res.headers['location'] ?? '';
        resolve(
          (res.statusCode ?? 0) >= 300 &&
          (res.statusCode ?? 0) < 400 &&
          location.startsWith('https://')
        );
      }
    );
    req.setTimeout(5000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.end();
  });
}

export async function inspectTls(url: string): Promise<TlsInfo> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('TLS inspection requires an HTTPS URL');
  }

  const host = parsed.hostname;
  const port = parseInt(parsed.port || '443', 10);

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false },
      async () => {
        const cert = socket.getPeerCertificate(true);
        const protocol = socket.getProtocol() ?? 'unknown';
        const cipher = socket.getCipher();

        if (!cert || !cert.subject) {
          socket.destroy();
          reject(new Error('Could not retrieve certificate'));
          return;
        }

        const validFrom = new Date(cert.valid_from);
        const validTo = new Date(cert.valid_to);
        const now = new Date();
        const daysUntilExpiry = Math.floor(
          (validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        const subjectCN = (Array.isArray(cert.subject?.CN) ? cert.subject.CN[0] : cert.subject?.CN) ?? '';
        const issuerCN  = (Array.isArray(cert.issuer?.CN)  ? cert.issuer.CN[0]  : cert.issuer?.CN)  ?? '';
        const selfSigned = subjectCN === issuerCN;

        const altNames: string[] = [];
        if (cert.subjectaltname) {
          cert.subjectaltname.split(', ').forEach(san => {
            const val = san.replace(/^DNS:|^IP Address:/, '').trim();
            if (val) altNames.push(val);
          });
        }

        const cipherBits = (cipher as unknown as { bits?: number }).bits ?? 0;
        const cipherName = cipher.name;

        // Fetch HSTS header via HTTPS HEAD request
        const hstsResult = await new Promise<{
          hstsPresent: boolean;
          hstsMaxAge: number | null;
          hstsIncludeSubdomains: boolean;
          hstsPreload: boolean;
        }>(res => {
          const req = https.request(
            { host, port, path: parsed.pathname || '/', method: 'HEAD', rejectUnauthorized: false },
            resp => {
              const hstsHeader = resp.headers['strict-transport-security'] ?? '';
              const hstsPresent = !!hstsHeader;
              const maxAgeMatch = hstsHeader.match(/max-age=(\d+)/i);
              const hstsMaxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : null;
              res({
                hstsPresent,
                hstsMaxAge,
                hstsIncludeSubdomains: /includeSubDomains/i.test(hstsHeader),
                hstsPreload: /preload/i.test(hstsHeader),
              });
            }
          );
          req.on('error', () => res({ hstsPresent: false, hstsMaxAge: null, hstsIncludeSubdomains: false, hstsPreload: false }));
          req.setTimeout(5000, () => { req.destroy(); res({ hstsPresent: false, hstsMaxAge: null, hstsIncludeSubdomains: false, hstsPreload: false }); });
          req.end();
        });

        // Check HTTP→HTTPS redirect
        const httpRedirectsToHttps = await checkHttpRedirect(host, parsed.pathname);

        socket.destroy();

        // ── Build issues list with severity types ──────────────────────────────
        const issues: TlsIssue[] = [];

        // CRITICAL: cert expired or self-signed
        if (daysUntilExpiry < 0) {
          issues.push({ severity: 'critical', issue: 'Certificate is expired' });
        }
        if (selfSigned) {
          issues.push({ severity: 'critical', issue: 'Self-signed certificate — not trusted by browsers' });
        }

        // CRITICAL: broken protocol
        if (BROKEN_PROTOCOLS.has(protocol)) {
          issues.push({ severity: 'critical', issue: `Broken TLS protocol in use: ${protocol} (POODLE/BEAST attacks)` });
        }

        // HIGH: cert expiring soon
        if (daysUntilExpiry >= 0 && daysUntilExpiry < 14) {
          issues.push({ severity: 'high', issue: `Certificate expires in ${daysUntilExpiry} days — renew immediately` });
        } else if (daysUntilExpiry >= 14 && daysUntilExpiry < 30) {
          issues.push({ severity: 'medium', issue: `Certificate expires in ${daysUntilExpiry} days` });
        }

        // HIGH: missing HSTS entirely
        if (!hstsResult.hstsPresent) {
          issues.push({ severity: 'high', issue: 'HSTS header missing — HTTPS not enforced; downgrade attacks possible' });
        } else {
          // MEDIUM: HSTS max-age too short (< 1 year)
          if (hstsResult.hstsMaxAge !== null && hstsResult.hstsMaxAge < 31536000) {
            issues.push({ severity: 'medium', issue: `HSTS max-age is ${hstsResult.hstsMaxAge}s — should be ≥31536000 (1 year)` });
          }
          // LOW: missing includeSubDomains
          if (!hstsResult.hstsIncludeSubdomains) {
            issues.push({ severity: 'low', issue: 'HSTS missing includeSubDomains — subdomains not protected' });
          }
          // LOW: missing preload
          if (!hstsResult.hstsPreload) {
            issues.push({ severity: 'low', issue: 'HSTS missing preload directive — site not in browser preload list' });
          }
        }

        // HIGH: HTTP does NOT redirect to HTTPS
        if (!httpRedirectsToHttps) {
          issues.push({ severity: 'high', issue: 'HTTP (port 80) does not redirect to HTTPS — plain HTTP served' });
        }

        // HIGH: weak cipher
        if (WEAK_CIPHER_PATTERNS.some(p => p.test(cipherName))) {
          issues.push({ severity: 'high', issue: `Weak cipher in use: ${cipherName}` });
        }

        // MEDIUM: cipher key too short
        if (cipherBits > 0 && cipherBits < 128) {
          issues.push({ severity: 'medium', issue: `Cipher key length too short: ${cipherBits} bits` });
        }

        resolve({
          protocol,
          cipher: cipherName,
          cipherBits,
          cert: {
            subject: subjectCN,
            issuer: issuerCN,
            validFrom: validFrom.toISOString(),
            validTo: validTo.toISOString(),
            daysUntilExpiry,
            expired: daysUntilExpiry < 0,
            selfSigned,
            serialNumber: cert.serialNumber ?? '',
            fingerprint: cert.fingerprint256 ?? cert.fingerprint ?? '',
            subjectAltNames: altNames,
          },
          hstsPresent: hstsResult.hstsPresent,
          hstsMaxAge: hstsResult.hstsMaxAge,
          hstsIncludeSubdomains: hstsResult.hstsIncludeSubdomains,
          hstsPreload: hstsResult.hstsPreload,
          httpRedirectsToHttps,
          grade: computeGrade(issues),
          issues,
        });
      }
    );
    socket.on('error', reject);
  });
}

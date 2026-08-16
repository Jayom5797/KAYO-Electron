import * as https from 'node:https';
import type { TechSignature } from './fingerprint.js';

export interface CveFinding {
  component: string;
  version: string;
  id: string;          // CVE / GHSA / OSV id
  severity: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  summary: string;
}

// Map our fingerprint technology names to OSV package coordinates.
// Only components with a clean ecosystem mapping are queryable; others are skipped.
const OSV_PACKAGE_MAP: Record<string, { ecosystem: string; name: string }> = {
  'jQuery':     { ecosystem: 'npm', name: 'jquery' },
  'Bootstrap':  { ecosystem: 'npm', name: 'bootstrap' },
  'React':      { ecosystem: 'npm', name: 'react' },
  'Vue.js':     { ecosystem: 'npm', name: 'vue' },
  'Angular':    { ecosystem: 'npm', name: '@angular/core' },
  'Next.js':    { ecosystem: 'npm', name: 'next' },
  'Express.js': { ecosystem: 'npm', name: 'express' },
};

interface OsvVuln {
  id?: string;
  summary?: string;
  details?: string;
  severity?: Array<{ type?: string; score?: string }>;
  database_specific?: { severity?: string };
}

function queryOsv(ecosystem: string, name: string, version: string): Promise<OsvVuln[]> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ package: { ecosystem, name }, version });
    const req = https.request(
      {
        hostname: 'api.osv.dev',
        path: '/v1/query',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 6000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; if (data.length > 500000) data = data.slice(0, 500000); });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { vulns?: OsvVuln[] };
            resolve(parsed.vulns ?? []);
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
    req.write(payload);
    req.end();
  });
}

function normalizeSeverity(vuln: OsvVuln): CveFinding['severity'] {
  const dbSev = vuln.database_specific?.severity?.toLowerCase();
  if (dbSev) {
    if (dbSev.includes('critical')) return 'critical';
    if (dbSev.includes('high')) return 'high';
    if (dbSev.includes('moderate') || dbSev.includes('medium')) return 'medium';
    if (dbSev.includes('low')) return 'low';
  }
  // Fall back to CVSS score if present
  const cvss = vuln.severity?.find((s) => s.type?.includes('CVSS'))?.score;
  if (cvss) {
    const m = cvss.match(/\/AV:|(\d+\.\d+)/); // try to pull a base score if it's numeric
    const num = Number(cvss);
    const score = Number.isFinite(num) ? num : (m && Number(m[1])) || NaN;
    if (Number.isFinite(score)) {
      if (score >= 9) return 'critical';
      if (score >= 7) return 'high';
      if (score >= 4) return 'medium';
      return 'low';
    }
  }
  return 'unknown';
}

/**
 * Looks up known vulnerabilities for a single package version via OSV.dev.
 * Reusable by both the fingerprint correlator and the repo dependency scanner.
 */
export async function lookupPackageCves(
  ecosystem: string,
  name: string,
  version: string,
  componentLabel?: string,
): Promise<CveFinding[]> {
  const vulns = await queryOsv(ecosystem, name, version);
  return vulns.slice(0, 10).map<CveFinding>((v) => ({
    component: componentLabel ?? name,
    version,
    id: v.id ?? 'UNKNOWN',
    severity: normalizeSeverity(v),
    summary: (v.summary ?? v.details ?? 'No summary available').slice(0, 200),
  }));
}

/**
 * Correlates fingerprinted technologies (that have a detected version) against
 * the OSV.dev vulnerability database. Best-effort and network-dependent:
 * any failure yields no findings rather than throwing.
 */
export async function correlateCves(technologies: TechSignature[]): Promise<CveFinding[]> {
  const targets = technologies
    .filter((t) => t.version && OSV_PACKAGE_MAP[t.name])
    .slice(0, 8); // cap outbound queries

  const results = await Promise.all(
    targets.map(async (t) => {
      const pkg = OSV_PACKAGE_MAP[t.name];
      return lookupPackageCves(pkg.ecosystem, pkg.name, t.version as string, t.name);
    })
  );

  return results.flat();
}

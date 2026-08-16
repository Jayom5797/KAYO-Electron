import type { RepoFile, DependencyFinding } from './types.js';
import { lookupPackageCves } from '../security/cve.js';

interface ParsedDep {
  ecosystem: string;
  name: string;
  version: string;
  approximate: boolean;
}

function cleanVersion(v: string): { version: string; approximate: boolean } {
  const approximate = /[\^~><*x]|\s-\s|\|\|/.test(v);
  // Strip range operators to a concrete-ish base version (best effort)
  const m = v.match(/(\d+\.\d+(?:\.\d+)?)/);
  return { version: m ? m[1] : v.replace(/[^\d.]/g, ''), approximate };
}

// ── package-lock.json (npm v2/v3 — exact versions) ────────────────────────────
function parsePackageLock(content: string): ParsedDep[] {
  try {
    const json = JSON.parse(content);
    const deps: ParsedDep[] = [];
    const packages = json.packages || {};
    for (const [path, info] of Object.entries<Record<string, unknown>>(packages)) {
      if (!path || path === '') continue; // root
      const name = path.replace(/^.*node_modules\//, '');
      const version = (info as { version?: string }).version;
      if (name && version) deps.push({ ecosystem: 'npm', name, version, approximate: false });
    }
    // Fallback for lockfile v1 "dependencies"
    if (deps.length === 0 && json.dependencies) {
      for (const [name, info] of Object.entries<Record<string, unknown>>(json.dependencies)) {
        const version = (info as { version?: string }).version;
        if (version) deps.push({ ecosystem: 'npm', name, version, approximate: false });
      }
    }
    return deps;
  } catch { return []; }
}

// ── package.json (ranges — approximate) ───────────────────────────────────────
function parsePackageJson(content: string): ParsedDep[] {
  try {
    const json = JSON.parse(content);
    const deps: ParsedDep[] = [];
    for (const field of ['dependencies', 'devDependencies']) {
      const block = json[field] || {};
      for (const [name, range] of Object.entries<string>(block)) {
        const { version, approximate } = cleanVersion(range);
        if (version) deps.push({ ecosystem: 'npm', name, version, approximate });
      }
    }
    return deps;
  } catch { return []; }
}

// ── requirements.txt (PyPI) ───────────────────────────────────────────────────
function parseRequirements(content: string): ParsedDep[] {
  const deps: ParsedDep[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9._-]+)\s*==\s*([0-9][\w.]*)/);
    if (m) deps.push({ ecosystem: 'PyPI', name: m[1], version: m[2], approximate: false });
  }
  return deps;
}

// ── go.mod (Go) ───────────────────────────────────────────────────────────────
function parseGoMod(content: string): ParsedDep[] {
  const deps: ParsedDep[] = [];
  const re = /^\s*([\w.\-/]+)\s+v(\d+\.\d+\.\d+[\w.\-+]*)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[1] === 'module' || m[1] === 'go') continue;
    deps.push({ ecosystem: 'Go', name: m[1], version: 'v' + m[2], approximate: false });
  }
  return deps;
}

// ── Gemfile.lock (RubyGems) ───────────────────────────────────────────────────
function parseGemfileLock(content: string): ParsedDep[] {
  const deps: ParsedDep[] = [];
  const re = /^\s{4}([a-zA-Z0-9._-]+)\s+\(([0-9][\w.]*)\)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    deps.push({ ecosystem: 'RubyGems', name: m[1], version: m[2], approximate: false });
  }
  return deps;
}

function selectManifests(files: RepoFile[]): Array<{ file: RepoFile; deps: ParsedDep[] }> {
  const results: Array<{ file: RepoFile; deps: ParsedDep[] }> = [];
  // Prefer lock files over manifests for the same ecosystem to get exact versions.
  const hasNpmLock = files.some((f) => /(^|\/)package-lock\.json$/i.test(f.path));

  for (const f of files) {
    const name = f.path.toLowerCase();
    if (/(^|\/)package-lock\.json$/.test(name)) results.push({ file: f, deps: parsePackageLock(f.content) });
    else if (/(^|\/)package\.json$/.test(name) && !hasNpmLock) results.push({ file: f, deps: parsePackageJson(f.content) });
    else if (/(^|\/)requirements\.txt$/.test(name)) results.push({ file: f, deps: parseRequirements(f.content) });
    else if (/(^|\/)go\.mod$/.test(name)) results.push({ file: f, deps: parseGoMod(f.content) });
    else if (/(^|\/)gemfile\.lock$/.test(name)) results.push({ file: f, deps: parseGemfileLock(f.content) });
  }
  return results;
}

/**
 * Scans dependency manifests for known-vulnerable versions via OSV.dev.
 * Caps total OSV queries to stay polite and fast.
 */
export async function scanDependencies(files: RepoFile[]): Promise<DependencyFinding[]> {
  const manifests = selectManifests(files);

  // Flatten with their source manifest, dedupe by ecosystem+name+version, cap.
  const seen = new Set<string>();
  const queue: Array<{ manifest: string; dep: ParsedDep }> = [];
  for (const { file, deps } of manifests) {
    for (const dep of deps) {
      const key = `${dep.ecosystem}:${dep.name}:${dep.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ manifest: file.path, dep });
    }
  }

  const MAX_QUERIES = 200;
  const targets = queue.slice(0, MAX_QUERIES);
  const findings: DependencyFinding[] = [];

  const concurrency = 10;
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async ({ manifest, dep }) => {
      const cves = await lookupPackageCves(dep.ecosystem, dep.name, dep.version, dep.name).catch(() => []);
      if (cves.length === 0) return null;
      return {
        manifest, ecosystem: dep.ecosystem, package: dep.name,
        version: dep.version, approximate: dep.approximate, cves,
      } as DependencyFinding;
    }));
    for (const r of results) if (r) findings.push(r);
  }

  // Sort by worst CVE severity
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
  return findings.sort((a, b) => {
    const sa = Math.min(...a.cves.map((c) => order[c.severity] ?? 4));
    const sb = Math.min(...b.cves.map((c) => order[c.severity] ?? 4));
    return sa - sb;
  });
}

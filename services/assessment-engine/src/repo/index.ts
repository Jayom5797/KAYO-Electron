import { parseGithubUrl } from './githubUrl.js';
import { fetchViaApi, fetchViaClone } from './fetchRepo.js';
import { scanSecrets } from './secretScanner.js';
import { scanDependencies } from './depScanner.js';
import { scanWorkflows } from './workflowScanner.js';
import { checkHygiene, scanCodePatterns } from './hygiene.js';
import { analyzeCodeHealth } from './codeHealth.js';
import type { RepoAnalysisResult, Severity } from './types.js';

export interface RepoAnalysisOptions {
  /** false = basic (GitHub API snapshot); true = advanced (git clone + history). */
  advanced?: boolean;
  /** Optional GitHub token for higher rate limits / private repos. */
  token?: string;
}

/**
 * Full repository security analysis.
 *  - basic mode: GitHub REST API snapshot (no git, current files only)
 *  - advanced mode: git clone with full git-history secret scanning
 */
export async function analyzeRepo(
  rawUrl: string,
  options: RepoAnalysisOptions = {},
): Promise<RepoAnalysisResult> {
  const parsed = parseGithubUrl(rawUrl);
  if (!parsed.ok) throw new Error(parsed.error);

  const warnings: string[] = [];
  const mode: 'basic' | 'advanced' = options.advanced ? 'advanced' : 'basic';

  const fetched = mode === 'advanced'
    ? await fetchViaClone(parsed.value)
    : await fetchViaApi(parsed.value, options.token);

  if (fetched.truncated) {
    warnings.push('Repository is very large — the file tree was truncated, so analysis is partial.');
  }
  if (mode === 'basic' && fetched.files.length === 0) {
    warnings.push('No scannable text files were retrieved.');
  }

  // Run scanners. Dependency scan is async (OSV network); others are synchronous.
  const [dependencies] = await Promise.all([
    scanDependencies(fetched.files).catch((e) => {
      warnings.push(`Dependency scan failed: ${(e as Error).message}`);
      return [];
    }),
  ]);

  const secrets = scanSecrets(fetched.files, fetched.historyPatch);
  const workflows = scanWorkflows(fetched.files);
  const hygiene = checkHygiene(fetched.files);
  const codePatterns = scanCodePatterns(fetched.files);
  const codeHealth = analyzeCodeHealth(fetched.files);

  // Aggregate severity counts across every finding type.
  const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 };
  const bump = (sev: Severity) => { summary[sev]++; summary.total++; };
  for (const s of secrets) bump(s.severity);
  for (const w of workflows) bump(w.severity);
  for (const h of hygiene) bump(h.severity);
  for (const c of codePatterns) bump(c.severity);
  for (const d of dependencies) {
    // Count the worst CVE severity per dependency
    const worst = d.cves.reduce<Severity>((acc, c) => {
      const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      const cs = (c.severity === 'unknown' ? 'low' : c.severity) as Severity;
      return (rank[cs] ?? 3) < (rank[acc] ?? 3) ? cs : acc;
    }, 'low');
    bump(worst);
  }

  return {
    repo: {
      owner: fetched.owner,
      repo: fetched.repo,
      branch: fetched.branch,
      url: `https://github.com/${fetched.owner}/${fetched.repo}`,
    },
    mode,
    source: fetched.source,
    fileCount: fetched.files.length,
    truncated: fetched.truncated,
    historyCommits: fetched.historyCommits,
    secrets,
    dependencies,
    hygiene,
    workflows,
    codePatterns,
    codeHealth,
    summary,
    warnings,
  };
}

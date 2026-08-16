export interface ParsedRepo {
  owner: string;
  repo: string;
  /** Optional branch parsed from a /tree/<branch> URL. */
  branch?: string;
}

export type RepoUrlResult =
  | { ok: true; value: ParsedRepo }
  | { ok: false; error: string };

/**
 * Parses and validates a GitHub repository URL or "owner/repo" shorthand.
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo/tree/branch
 *   git@github.com:owner/repo.git
 *   owner/repo
 */
export function parseGithubUrl(input: string): RepoUrlResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: 'Repository URL is required' };

  // owner/repo shorthand (no scheme, no host)
  const shorthand = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/;
  if (!raw.includes('://') && !raw.includes('@') && shorthand.test(raw)) {
    const m = raw.match(shorthand)!;
    return { ok: true, value: { owner: m[1], repo: m[2] } };
  }

  // git@github.com:owner/repo.git
  const ssh = /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/;
  if (ssh.test(raw)) {
    const m = raw.match(ssh)!;
    return { ok: true, value: { owner: m[1], repo: m[2] } };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: `Invalid URL: "${raw}"` };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: 'Only HTTPS GitHub URLs are supported' };
  }
  if (!/(^|\.)github\.com$/i.test(url.hostname)) {
    return { ok: false, error: 'Only github.com repositories are supported' };
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return { ok: false, error: 'URL must point to a repository: github.com/owner/repo' };
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, '');
  // /tree/<branch>
  let branch: string | undefined;
  if (segments[2] === 'tree' && segments[3]) {
    branch = segments.slice(3).join('/');
  }

  return { ok: true, value: { owner, repo, branch } };
}

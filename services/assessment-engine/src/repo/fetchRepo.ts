import * as https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { ParsedRepo } from './githubUrl.js';
import type { RepoFile, RepoFetchResult } from './types.js';

const execFileAsync = promisify(execFile);

const USER_AGENT = 'ASTRA-Repo-Analyzer';
const MAX_FILES = 1500;             // cap files scanned
const MAX_FILE_BYTES = 512 * 1024;  // skip files larger than 512 KB
const MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB total content budget

// File extensions worth scanning for secrets / code patterns / config.
const TEXT_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|php|cs|c|cpp|h|sh|bash|zsh|ps1|yml|yaml|json|toml|ini|cfg|conf|env|properties|xml|gradle|tf|tfvars|lock|md|txt|html|vue|svelte|sql|dockerfile)$/i;
const ALWAYS_INCLUDE = /(^|\/)(\.env(\..+)?|\.gitignore|dockerfile|gemfile|gemfile\.lock|requirements\.txt|package\.json|package-lock\.json|go\.mod|go\.sum|composer\.json|cargo\.toml|cargo\.lock|\.github\/workflows\/.+\.ya?ml|security\.md|\.npmrc|\.dockerignore)$/i;

interface GitTreeEntry { path: string; type: string; size?: number; }

function httpsJson<T>(url: string, token?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'Accept': 'application/vnd.github+json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = https.request(url, { headers, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if ((res.statusCode ?? 0) === 404) return reject(new Error('Repository not found (or private without a token)'));
        if ((res.statusCode ?? 0) === 403) return reject(new Error('GitHub API rate limit reached or access forbidden. Add a token in Settings.'));
        if ((res.statusCode ?? 0) >= 400) return reject(new Error(`GitHub API error ${res.statusCode}`));
        try { resolve(JSON.parse(data) as T); } catch { reject(new Error('Invalid JSON from GitHub API')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('GitHub API request timed out')); });
    req.end();
  });
}

function httpsText(url: string, token?: string): Promise<string> {
  return new Promise((resolve, _reject) => {
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = https.request(url, { headers, timeout: 15000 }, (res) => {
      // follow one redirect (raw.githubusercontent sometimes redirects)
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        res.resume();
        return resolve(httpsText(res.headers.location, token));
      }
      if ((res.statusCode ?? 0) >= 400) { res.resume(); return resolve(''); }
      let data = '';
      let bytes = 0;
      res.on('data', (c) => {
        bytes += c.length;
        if (bytes <= MAX_FILE_BYTES) data += c;
      });
      res.on('end', () => resolve(data));
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.end();
  });
}

function shouldScan(path: string): boolean {
  if (ALWAYS_INCLUDE.test(path)) return true;
  if (/(^|\/)(node_modules|\.git|dist|build|vendor|venv|__pycache__|\.next|coverage)\//i.test(path)) return false;
  return TEXT_EXT.test(path);
}

// ── Option A: GitHub REST API (snapshot, no git, no history) ──────────────────
export async function fetchViaApi(parsed: ParsedRepo, token?: string): Promise<RepoFetchResult> {
  const { owner, repo } = parsed;
  const meta = await httpsJson<{ default_branch: string }>(
    `https://api.github.com/repos/${owner}/${repo}`, token);
  const branch = parsed.branch || meta.default_branch;

  const tree = await httpsJson<{ tree: GitTreeEntry[]; truncated: boolean }>(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);

  const candidates = tree.tree
    .filter((e) => e.type === 'blob' && shouldScan(e.path) && (e.size ?? 0) <= MAX_FILE_BYTES)
    .slice(0, MAX_FILES);

  const files: RepoFile[] = [];
  let totalBytes = 0;
  // Fetch raw contents via the CDN (does not consume API rate limit). Bounded concurrency.
  const concurrency = 12;
  for (let i = 0; i < candidates.length; i += concurrency) {
    if (totalBytes >= MAX_TOTAL_BYTES) break;
    const batch = candidates.slice(i, i + concurrency);
    const fetched = await Promise.all(batch.map(async (e) => {
      const content = await httpsText(
        `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${e.path.split('/').map(encodeURIComponent).join('/')}`,
        token);
      return { path: e.path, content, size: e.size ?? content.length };
    }));
    for (const f of fetched) {
      if (!f.content) continue;
      totalBytes += f.content.length;
      files.push(f);
    }
  }

  return {
    owner, repo, branch, defaultBranch: meta.default_branch,
    files, truncated: tree.truncated, source: 'api',
  };
}

// ── Option B: git clone (full history scanning) ───────────────────────────────
async function gitAvailable(): Promise<boolean> {
  try { await execFileAsync('git', ['--version'], { timeout: 5000 }); return true; }
  catch { return false; }
}

async function walkDir(root: string, dir: string, out: RepoFile[], totalRef: { bytes: number }): Promise<void> {
  if (totalRef.bytes >= MAX_TOTAL_BYTES || out.length >= MAX_FILES) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join('/');
    if (/(^|\/)\.git(\/|$)/.test(rel)) continue;
    if (entry.isDirectory()) {
      if (/(^|\/)(node_modules|dist|build|vendor|venv|__pycache__|\.next|coverage)$/i.test(rel)) continue;
      await walkDir(root, full, out, totalRef);
    } else if (entry.isFile() && shouldScan(rel)) {
      try {
        const s = await stat(full);
        if (s.size > MAX_FILE_BYTES) continue;
        const content = await readFile(full, 'utf8');
        totalRef.bytes += content.length;
        out.push({ path: rel, content, size: s.size });
        if (totalRef.bytes >= MAX_TOTAL_BYTES || out.length >= MAX_FILES) return;
      } catch { /* skip unreadable/binary */ }
    }
  }
}

export async function fetchViaClone(parsed: ParsedRepo): Promise<RepoFetchResult> {
  if (!(await gitAvailable())) {
    throw new Error('Advanced mode requires git to be installed and on PATH.');
  }
  const { owner, repo } = parsed;
  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  const dir = await mkdtemp(join(tmpdir(), 'astra-repo-'));

  try {
    await execFileAsync('git', ['clone', '--quiet', cloneUrl, dir], {
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    });

    if (parsed.branch) {
      try { await execFileAsync('git', ['-C', dir, 'checkout', '--quiet', parsed.branch], { timeout: 30000 }); }
      catch { /* branch may not exist; stay on default */ }
    }

    // Current default branch name
    let branch = parsed.branch || 'HEAD';
    try {
      const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 10000 });
      branch = stdout.trim() || branch;
    } catch { /* ignore */ }

    // Working-tree files
    const files: RepoFile[] = [];
    await walkDir(dir, dir, files, { bytes: 0 });

    // Full history patch text for secret-in-history scanning (bounded)
    let historyPatch = '';
    let historyCommits = 0;
    try {
      const countRes = await execFileAsync('git', ['-C', dir, 'rev-list', '--all', '--count'], { timeout: 20000 });
      historyCommits = parseInt(countRes.stdout.trim(), 10) || 0;
      const logRes = await execFileAsync(
        'git',
        ['-C', dir, 'log', '-p', '--all', '--no-color', '--unified=0', '--', '.'],
        { timeout: 120000, maxBuffer: 128 * 1024 * 1024 },
      );
      historyPatch = logRes.stdout.slice(0, 20 * 1024 * 1024); // cap 20MB
    } catch { /* history scan best-effort */ }

    return {
      owner, repo, branch, defaultBranch: branch,
      files, truncated: false, source: 'clone',
      historyPatch, historyCommits,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

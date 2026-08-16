import { describe, it, expect } from 'vitest';
import { parseGithubUrl } from '../repo/githubUrl.js';
import { scanSecrets } from '../repo/secretScanner.js';
import { scanWorkflows } from '../repo/workflowScanner.js';
import { checkHygiene, scanCodePatterns } from '../repo/hygiene.js';
import type { RepoFile } from '../repo/types.js';

function file(path: string, content: string): RepoFile {
  return { path, content, size: content.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub URL parsing
// ─────────────────────────────────────────────────────────────────────────────
describe('parseGithubUrl', () => {
  it('parses a standard https URL', () => {
    const r = parseGithubUrl('https://github.com/torvalds/linux');
    expect(r.ok && r.value.owner).toBe('torvalds');
    expect(r.ok && r.value.repo).toBe('linux');
  });

  it('strips a trailing .git', () => {
    const r = parseGithubUrl('https://github.com/owner/repo.git');
    expect(r.ok && r.value.repo).toBe('repo');
  });

  it('extracts a branch from /tree/<branch>', () => {
    const r = parseGithubUrl('https://github.com/owner/repo/tree/develop');
    expect(r.ok && r.value.branch).toBe('develop');
  });

  it('accepts owner/repo shorthand', () => {
    const r = parseGithubUrl('owner/repo');
    expect(r.ok && r.value.owner).toBe('owner');
  });

  it('accepts SSH form', () => {
    const r = parseGithubUrl('git@github.com:owner/repo.git');
    expect(r.ok && r.value.repo).toBe('repo');
  });

  it('rejects non-github hosts', () => {
    const r = parseGithubUrl('https://gitlab.com/owner/repo');
    expect(r.ok).toBe(false);
  });

  it('rejects a URL with no repo', () => {
    const r = parseGithubUrl('https://github.com/owner');
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Secret scanner
// ─────────────────────────────────────────────────────────────────────────────
describe('scanSecrets', () => {
  it('detects an AWS access key id', () => {
    // "AKIA...EXAMPLE" contains "example" → filtered as a placeholder. Use a non-placeholder one:
    const real = scanSecrets([file('config.js', 'const k = "AKIA1234567890ABCDEF";')]);
    expect(real.some(f => f.type === 'AWS Access Key ID')).toBe(true);
  });

  it('detects a GitHub personal access token', () => {
    const token = 'ghp_' + 'a'.repeat(36);
    const findings = scanSecrets([file('deploy.sh', `export GH_TOKEN=${token}`)]);
    expect(findings.some(f => f.type === 'GitHub Personal Token')).toBe(true);
  });

  it('does NOT flag placeholder values', () => {
    const findings = scanSecrets([file('.env.example', 'API_KEY=your_api_key_here')]);
    expect(findings.length).toBe(0);
  });

  it('does NOT flag env var references', () => {
    const findings = scanSecrets([file('app.js', 'const key = process.env.API_KEY;')]);
    expect(findings.length).toBe(0);
  });

  it('redacts the secret value in the match preview', () => {
    const token = 'ghp_' + 'b'.repeat(36);
    const findings = scanSecrets([file('x.sh', token)]);
    const f = findings.find(x => x.type === 'GitHub Personal Token');
    expect(f?.match).toContain('•');
    expect(f?.match).not.toContain('bbbbbbbbbbbb');
  });

  it('marks history-only findings with inHistory=true', () => {
    const token = 'ghp_' + 'c'.repeat(36);
    const patch = `+++ b/secret.txt\n+API=${token}`;
    const findings = scanSecrets([], patch);
    expect(findings.some(f => f.inHistory && f.type === 'GitHub Personal Token')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Workflow scanner
// ─────────────────────────────────────────────────────────────────────────────
describe('scanWorkflows', () => {
  it('flags pull_request_target', () => {
    const findings = scanWorkflows([
      file('.github/workflows/ci.yml', 'on:\n  pull_request_target:\njobs:\n  x:\n    runs-on: ubuntu-latest'),
    ]);
    expect(findings.some(f => /pull_request_target/.test(f.issue))).toBe(true);
  });

  it('flags unpinned third-party actions but not SHA-pinned ones', () => {
    const findings = scanWorkflows([
      file('.github/workflows/ci.yml', 'jobs:\n  x:\n    steps:\n      - uses: some/action@v3\n      - uses: actions/checkout@v4'),
    ]);
    // some/action@v3 is unpinned third-party; actions/* is first-party (skipped)
    expect(findings.some(f => /unpinned/i.test(f.issue))).toBe(true);
  });

  it('does not flag a SHA-pinned third-party action', () => {
    const sha = 'a'.repeat(40);
    const findings = scanWorkflows([
      file('.github/workflows/ci.yml', `jobs:\n  x:\n    steps:\n      - uses: some/action@${sha}`),
    ]);
    expect(findings.some(f => /unpinned/i.test(f.issue))).toBe(false);
  });

  it('flags permissions: write-all', () => {
    const findings = scanWorkflows([
      file('.github/workflows/ci.yml', 'permissions: write-all\njobs: {}'),
    ]);
    expect(findings.some(f => /write-all/.test(f.issue))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Hygiene + code patterns
// ─────────────────────────────────────────────────────────────────────────────
describe('checkHygiene', () => {
  it('flags a committed .env file as critical', () => {
    const findings = checkHygiene([file('.env', 'SECRET=x'), file('.gitignore', '.env')]);
    expect(findings.some(f => f.severity === 'critical' && /\.env file committed/.test(f.finding))).toBe(true);
  });

  it('flags .gitignore that does not ignore .env', () => {
    const findings = checkHygiene([file('.gitignore', 'node_modules/\ndist/')]);
    expect(findings.some(f => /does not ignore \.env/.test(f.finding))).toBe(true);
  });

  it('does not flag .env.example as a committed secret file', () => {
    const findings = checkHygiene([file('.env.example', 'API_KEY='), file('.gitignore', '.env')]);
    expect(findings.some(f => /\.env file committed/.test(f.finding))).toBe(false);
  });

  it('flags missing SECURITY.md', () => {
    const findings = checkHygiene([file('.gitignore', '.env')]);
    expect(findings.some(f => /SECURITY\.md/.test(f.finding))).toBe(true);
  });
});

describe('scanCodePatterns', () => {
  it('flags eval()', () => {
    const findings = scanCodePatterns([file('a.js', 'const x = eval(userInput);')]);
    expect(findings.some(f => /eval/.test(f.type))).toBe(true);
  });

  it('flags disabled TLS verification', () => {
    const findings = scanCodePatterns([file('a.js', 'const agent = new https.Agent({ rejectUnauthorized: false });')]);
    expect(findings.some(f => /TLS verification disabled/.test(f.type))).toBe(true);
  });

  it('flags Math.random used in code', () => {
    const findings = scanCodePatterns([file('token.js', 'const token = Math.random().toString(36);')]);
    expect(findings.some(f => /Insecure randomness/.test(f.type))).toBe(true);
  });

  it('does not scan non-applicable file types', () => {
    const findings = scanCodePatterns([file('readme.md', 'eval() is dangerous')]);
    expect(findings.length).toBe(0);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Code Health (quality / efficiency / accessibility)
// ─────────────────────────────────────────────────────────────────────────────
import { analyzeCodeHealth } from '../repo/codeHealth.js';

describe('analyzeCodeHealth', () => {
  it('produces a quality score and grade', () => {
    const ch = analyzeCodeHealth([
      file('src/a.js', 'function f() { return 1; }\n'.repeat(10)),
      file('src/a.test.js', 'test("x", () => {});'),
      file('.eslintrc.json', '{}'),
      file('.github/workflows/ci.yml', 'on: push'),
    ]);
    expect(ch.quality.score).toBeGreaterThan(0);
    expect(['A', 'B', 'C', 'D', 'F']).toContain(ch.quality.grade);
    expect(ch.quality.metrics.hasTests).toBe(true);
    expect(ch.quality.metrics.hasLinter).toBe(true);
    expect(ch.quality.metrics.hasCI).toBe(true);
  });

  it('penalizes a repo with no tests/linter/CI', () => {
    const withHygiene = analyzeCodeHealth([
      file('a.js', 'const x = 1;'),
      file('a.test.js', 'test()'),
      file('.eslintrc', '{}'),
      file('.github/workflows/ci.yml', 'on: push'),
    ]);
    const without = analyzeCodeHealth([file('a.js', 'const x = 1;')]);
    expect(without.quality.score).toBeLessThan(withHygiene.quality.score);
    expect(without.quality.metrics.hasTests).toBe(false);
  });

  it('flags a large file as a quality smell', () => {
    const ch = analyzeCodeHealth([file('big.js', 'const x = 1;\n'.repeat(500))]);
    expect(ch.quality.smells.some(s => /large file/i.test(s.type))).toBe(true);
  });

  it('detects efficiency anti-patterns (await in loop) but gives no score', () => {
    const ch = analyzeCodeHealth([
      file('a.js', 'for (const u of users) {\n  await fetchData(u);\n}'),
    ]);
    expect(ch.efficiency.smells.some(s => /await inside loop/i.test(s.type))).toBe(true);
    expect(ch.efficiency).not.toHaveProperty('score');
  });

  it('marks accessibility N/A when there is no markup', () => {
    const ch = analyzeCodeHealth([file('server.js', 'const x = 1;')]);
    expect(ch.accessibility.applicable).toBe(false);
    expect(ch.accessibility.score).toBeNull();
  });

  it('flags an image without alt and scores accessibility', () => {
    const ch = analyzeCodeHealth([file('index.html', '<html><body><img src="x.png"></body></html>')]);
    expect(ch.accessibility.applicable).toBe(true);
    expect(ch.accessibility.findings.some(f => /missing alt/i.test(f.type))).toBe(true);
    expect(typeof ch.accessibility.score).toBe('number');
  });

  it('flags missing lang attribute on html', () => {
    const ch = analyzeCodeHealth([file('page.html', '<html><head></head><body><img src="a" alt="a"></body></html>')]);
    expect(ch.accessibility.findings.some(f => /lang/i.test(f.type))).toBe(true);
  });
});

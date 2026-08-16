import type { RepoFile, HygieneFinding, CodePatternFinding, Severity } from './types.js';

/**
 * Repo hygiene checks — the same class of issues an analyst checks manually:
 * is .env ignored, are secret-like files committed, is there a security policy.
 */
export function checkHygiene(files: RepoFile[]): HygieneFinding[] {
  const findings: HygieneFinding[] = [];
  const paths = files.map((f) => f.path);
  const has = (re: RegExp) => paths.some((p) => re.test(p));

  const gitignore = files.find((f) => /(^|\/)\.gitignore$/.test(f.path));

  // .env committed to the repo
  const committedEnv = paths.filter((p) => /(^|\/)\.env(\.[\w.-]+)?$/i.test(p) && !/\.env\.example$|\.env\.sample$|\.env\.template$/i.test(p));
  if (committedEnv.length > 0) {
    findings.push({
      severity: 'critical',
      finding: '.env file committed to the repository',
      detail: `Found: ${committedEnv.join(', ')}. Environment files usually contain secrets and should never be committed. Remove from the repo and rotate any exposed credentials.`,
    });
  }

  // .gitignore missing entirely
  if (!gitignore) {
    findings.push({
      severity: 'medium',
      finding: 'No .gitignore file',
      detail: 'Without a .gitignore, build artifacts, dependencies, and secret files can be committed accidentally.',
    });
  } else {
    // .gitignore present but does not ignore .env
    if (!/(^|\n)\s*\.env\b/.test(gitignore.content) && !/(^|\n)\s*\*\.env/.test(gitignore.content)) {
      findings.push({
        severity: 'high',
        finding: '.gitignore does not ignore .env',
        detail: 'Add `.env` to .gitignore so environment secrets are not committed.',
      });
    }
  }

  // Committed key/credential files
  const keyFiles = paths.filter((p) => /\.(pem|key|p12|pfx|keystore|jks)$/i.test(p));
  if (keyFiles.length > 0) {
    findings.push({
      severity: 'high',
      finding: 'Key/credential files committed',
      detail: `Found: ${keyFiles.slice(0, 5).join(', ')}. Private keys and keystores should not live in source control.`,
    });
  }

  // No SECURITY.md
  if (!has(/(^|\/)security\.md$/i)) {
    findings.push({
      severity: 'low',
      finding: 'No SECURITY.md policy',
      detail: 'A SECURITY.md tells researchers how to report vulnerabilities responsibly.',
    });
  }

  // No Dependabot / dependency update config
  if (!has(/(^|\/)\.github\/dependabot\.ya?ml$/i) && !has(/(^|\/)renovate\.json$/i)) {
    findings.push({
      severity: 'low',
      finding: 'No automated dependency updates configured',
      detail: 'Add Dependabot (.github/dependabot.yml) or Renovate to get automatic alerts and PRs for vulnerable dependencies.',
    });
  }

  return findings;
}

// ── Dangerous code patterns (lightweight, language-agnostic heuristics) ───────
interface CodePattern {
  type: string;
  severity: Severity;
  pattern: RegExp;
  appliesTo: RegExp; // file extension filter
}

const CODE_PATTERNS: CodePattern[] = [
  { type: 'Use of eval()', severity: 'high', pattern: /\beval\s*\(/, appliesTo: /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|php)$/i },
  { type: 'Shell exec with interpolation', severity: 'high', pattern: /\b(exec|execSync|spawn|spawnSync|popen|system)\s*\([^)]*[`'"][^`'"]*\$\{/, appliesTo: /\.(js|jsx|ts|tsx|mjs|cjs)$/i },
  { type: 'Python os.system / subshell', severity: 'high', pattern: /\bos\.(system|popen)\s*\(|\bsubprocess\.[A-Za-z]+\([^)]*shell\s*=\s*True/, appliesTo: /\.py$/i },
  { type: 'SQL string concatenation', severity: 'medium', pattern: /(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,80}?["'`]\s*\+\s*\w|f["'`][\s\S]{0,80}?(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,80}?\{/i, appliesTo: /\.(js|jsx|ts|tsx|py|rb|php|java|go)$/i },
  { type: 'Weak hash (MD5/SHA1)', severity: 'medium', pattern: /\b(md5|sha1)\b/i, appliesTo: /\.(js|jsx|ts|tsx|py|rb|php|java|go)$/i },
  { type: 'Insecure randomness for tokens', severity: 'low', pattern: /Math\.random\(\)/, appliesTo: /\.(js|jsx|ts|tsx|mjs|cjs)$/i },
  { type: 'TLS verification disabled', severity: 'high', pattern: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(0|false)/i, appliesTo: /\.(js|jsx|ts|tsx|py|go|php)$/i },
];

export function scanCodePatterns(files: RepoFile[]): CodePatternFinding[] {
  const findings: CodePatternFinding[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    const applicable = CODE_PATTERNS.filter((p) => p.appliesTo.test(f.path));
    if (applicable.length === 0) continue;
    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 1000) continue;
      for (const cp of applicable) {
        if (cp.pattern.test(line)) {
          const key = `${cp.type}:${f.path}:${i}`;
          if (seen.has(key)) continue;
          seen.add(key);
          findings.push({
            file: f.path, line: i + 1, severity: cp.severity, type: cp.type,
            snippet: line.trim().slice(0, 160),
          });
        }
      }
    }
  }

  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 200);
}

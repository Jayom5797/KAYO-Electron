import type { RepoFile, SecretFinding, Severity } from './types.js';

interface SecretPattern {
  type: string;
  severity: Severity;
  pattern: RegExp;
}

// Source-code-focused secret patterns. Anchored/structured to limit false positives.
const SECRET_PATTERNS: SecretPattern[] = [
  { type: 'AWS Access Key ID',        severity: 'critical', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { type: 'AWS Secret Access Key',    severity: 'critical', pattern: /\baws_secret_access_key\b\s*[=:]\s*["']?[A-Za-z0-9/+]{40}["']?/i },
  { type: 'GitHub Personal Token',    severity: 'critical', pattern: /\bghp_[A-Za-z0-9]{36}\b/ },
  { type: 'GitHub OAuth Token',       severity: 'critical', pattern: /\bgho_[A-Za-z0-9]{36}\b/ },
  { type: 'GitHub App Token',         severity: 'critical', pattern: /\b(ghu|ghs)_[A-Za-z0-9]{36}\b/ },
  { type: 'Slack Token',              severity: 'high',     pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { type: 'Google API Key',          severity: 'high',     pattern: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { type: 'Stripe Secret Key',        severity: 'critical', pattern: /\bsk_(live|test)_[0-9a-zA-Z]{24,}\b/ },
  { type: 'Stripe Restricted Key',    severity: 'high',     pattern: /\brk_(live|test)_[0-9a-zA-Z]{24,}\b/ },
  { type: 'Twilio API Key',           severity: 'high',     pattern: /\bSK[0-9a-fA-F]{32}\b/ },
  { type: 'SendGrid API Key',         severity: 'high',     pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  { type: 'Private Key',              severity: 'critical', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { type: 'Generic API Key Assignment', severity: 'medium', pattern: /\b(?:api[_-]?key|apikey|secret|token|passwd|password)\b\s*[=:]\s*["'][A-Za-z0-9_-]{16,}["']/i },
  { type: 'JWT',                      severity: 'medium',   pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { type: 'Connection String w/ Password', severity: 'high', pattern: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^:@\s]+:[^@\s]+@/i },
  { type: 'Database URL Credential',  severity: 'high',     pattern: /\b(?:DATABASE_URL|DB_PASSWORD|DB_PASS)\b\s*[=:]\s*["']?[^\s"']{6,}/i },
];

// File patterns where a "generic key assignment" match is most likely a real secret.
const SENSITIVE_FILE = /(\.env|config|secret|credential|settings|\.pem|\.key)/i;

// Placeholder/example values that should NOT be flagged.
const PLACEHOLDER = /(your[_-]?(api[_-]?)?key|xxxx|example|placeholder|changeme|<[^>]+>|\$\{?\w+\}?|process\.env|os\.environ|REPLACE_ME|dummy|sample|test[_-]?key)/i;

function previewMatch(match: string): string {
  // Show only the first 6 chars of a detected secret, redact the rest.
  const trimmed = match.trim().slice(0, 60);
  if (trimmed.length <= 10) return trimmed.replace(/.(?=.{2})/g, '•');
  return trimmed.slice(0, 6) + '•'.repeat(Math.min(12, trimmed.length - 6));
}

function scanText(
  text: string,
  file: string,
  inHistory: boolean,
  sink: SecretFinding[],
  seen: Set<string>,
): void {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue; // skip minified/huge lines
    for (const { type, severity, pattern } of SECRET_PATTERNS) {
      const m = line.match(pattern);
      if (!m) continue;
      if (PLACEHOLDER.test(m[0])) continue;
      // Generic assignment only counts in sensitive files OR with high-entropy value
      if (type === 'Generic API Key Assignment' && !SENSITIVE_FILE.test(file) && inHistory) continue;
      const key = `${type}:${file}:${m[0].slice(0, 24)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sink.push({
        file,
        line: inHistory ? 0 : i + 1,
        type,
        severity,
        match: previewMatch(m[0]),
        inHistory,
      });
    }
  }
}

/**
 * Scans current files (and optionally git history patch text) for hardcoded secrets.
 */
export function scanSecrets(files: RepoFile[], historyPatch?: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    scanText(f.content, f.path, false, findings, seen);
  }

  if (historyPatch) {
    // Patch lines look like "+SECRET" / "-SECRET"; scan additions in history.
    // We attribute history hits to a synthetic "git history" file.
    const additions = historyPatch
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1))
      .join('\n');
    scanText(additions, '(git history)', true, findings, seen);
  }

  // Sort: current-tree findings first, then by severity
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return findings.sort((a, b) =>
    Number(a.inHistory) - Number(b.inHistory) || order[a.severity] - order[b.severity]);
}

import type { RepoFile } from './types.js';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface QualitySmell {
  file: string;
  type: string;
  detail: string;
}

export interface EfficiencySmell {
  file: string;
  line: number;
  type: string;
  snippet: string;
}

export interface A11yFinding {
  file: string;
  line: number;
  type: string;
  detail: string;
}

export interface CodeHealthReport {
  quality: {
    score: number;        // 0-100, heuristic
    grade: Grade;
    metrics: {
      filesAnalyzed: number;
      avgFileLines: number;
      largeFiles: number;       // > 400 lines
      deeplyNested: number;     // lines indented >= 6 levels
      todoCount: number;
      commentRatio: number;     // 0-1
      hasTests: boolean;
      hasLinter: boolean;
      hasCI: boolean;
      hasTypeChecking: boolean;
    };
    smells: QualitySmell[];
  };
  efficiency: {
    // Intentionally NO score — runtime efficiency can't be honestly measured statically.
    smells: EfficiencySmell[];
  };
  accessibility: {
    applicable: boolean;   // false when there's no front-end markup
    score: number | null;  // 0-100 for the markup scanned, null if N/A
    grade: Grade | null;
    htmlFilesScanned: number;
    findings: A11yFinding[];
  };
}

const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|php|cs|vue|svelte)$/i;
const MARKUP_EXT = /\.(html|htm|jsx|tsx|vue|svelte|php|erb|hbs)$/i;
const LARGE_FILE_LINES = 400;
const LONG_LINE = 140;

function gradeFromScore(score: number): Grade {
  return score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
}

// ── Quality ───────────────────────────────────────────────────────────────────
function analyzeQuality(files: RepoFile[]): CodeHealthReport['quality'] {
  const codeFiles = files.filter((f) => CODE_EXT.test(f.path) && !/\.(min)\./i.test(f.path));
  const smells: QualitySmell[] = [];

  let totalLines = 0;
  let totalCodeLines = 0;
  let totalCommentLines = 0;
  let largeFiles = 0;
  let deeplyNested = 0;
  let todoCount = 0;

  for (const f of codeFiles) {
    const lines = f.content.split('\n');
    totalLines += lines.length;
    if (lines.length > LARGE_FILE_LINES) {
      largeFiles++;
      smells.push({ file: f.path, type: 'Large file', detail: `${lines.length} lines — consider splitting into smaller modules.` });
    }
    let longLines = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^(\/\/|#|\*|<!--|--)/.test(trimmed)) totalCommentLines++;
      else totalCodeLines++;
      if (line.length > LONG_LINE) longLines++;
      // indentation depth: count leading spaces/tabs as levels (tab or 2-space)
      const indent = line.match(/^[ \t]*/)?.[0] ?? '';
      const levels = indent.replace(/\t/g, '  ').length / 2;
      if (levels >= 6) deeplyNested++;
      if (/\b(TODO|FIXME|HACK|XXX)\b/.test(trimmed)) todoCount++;
    }
    if (longLines > lines.length * 0.25 && lines.length > 30) {
      smells.push({ file: f.path, type: 'Many long lines', detail: `${longLines} lines exceed ${LONG_LINE} chars.` });
    }
  }

  const has = (re: RegExp) => files.some((f) => re.test(f.path));
  const hasTests = has(/(\.test\.|\.spec\.|_test\.|(^|\/)tests?\/|__tests__\/)/i);
  const hasLinter = has(/(^|\/)(\.eslintrc|eslint\.config|\.ruff|ruff\.toml|\.rubocop|\.flake8|biome\.json|\.golangci)/i);
  const hasCI = has(/(^|\/)\.github\/workflows\/.+\.ya?ml$/i) || has(/(^|\/)(\.gitlab-ci\.yml|\.circleci\/)/i);
  const hasTypeChecking = has(/(^|\/)tsconfig.*\.json$/i) || has(/(^|\/)mypy\.ini$/i) || has(/(^|\/)py\.typed$/i);

  const commentRatio = totalCodeLines > 0 ? totalCommentLines / (totalCodeLines + totalCommentLines) : 0;
  const avgFileLines = codeFiles.length > 0 ? Math.round(totalLines / codeFiles.length) : 0;

  // Scoring — start at 100, deduct for smells, reward for engineering hygiene.
  let score = 100;
  score -= Math.min(20, largeFiles * 4);
  score -= Math.min(15, Math.floor(deeplyNested / 5));
  score -= Math.min(10, Math.floor(todoCount / 3));
  if (avgFileLines > 300) score -= 8;
  if (commentRatio < 0.03 && totalCodeLines > 200) score -= 6; // almost no comments
  if (!hasTests) { score -= 15; smells.push({ file: '(repo)', type: 'No tests', detail: 'No test files or test directory detected.' }); }
  if (!hasLinter) { score -= 6; smells.push({ file: '(repo)', type: 'No linter config', detail: 'No ESLint/Ruff/RuboCop/Biome config detected.' }); }
  if (!hasCI) { score -= 6; smells.push({ file: '(repo)', type: 'No CI', detail: 'No CI workflow detected.' }); }
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    grade: gradeFromScore(score),
    metrics: {
      filesAnalyzed: codeFiles.length,
      avgFileLines,
      largeFiles,
      deeplyNested,
      todoCount,
      commentRatio: Math.round(commentRatio * 100) / 100,
      hasTests, hasLinter, hasCI, hasTypeChecking,
    },
    smells: smells.slice(0, 60),
  };
}

// ── Efficiency (findings only, no score) ──────────────────────────────────────
const EFFICIENCY_PATTERNS: Array<{ type: string; pattern: RegExp; ext: RegExp }> = [
  { type: 'await inside loop (possible N+1)', pattern: /\bfor\b[\s\S]{0,80}?\{[\s\S]{0,200}?\bawait\b/, ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i },
  { type: 'Synchronous I/O in code path', pattern: /\b(readFileSync|writeFileSync|execSync|readdirSync)\b/, ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i },
  { type: 'SELECT * query', pattern: /SELECT\s+\*\s+FROM/i, ext: /\.(js|jsx|ts|tsx|py|rb|php|java|go|sql)$/i },
  { type: 'forEach with async callback', pattern: /\.forEach\s*\(\s*async\b/, ext: /\.(js|jsx|ts|tsx|mjs|cjs)$/i },
  { type: 'Repeated DOM query in loop', pattern: /\b(for|while)\b[\s\S]{0,60}?\{[\s\S]{0,120}?document\.(querySelector|getElementById)/, ext: /\.(js|jsx|ts|tsx)$/i },
];

function analyzeEfficiency(files: RepoFile[]): EfficiencySmell[] {
  const smells: EfficiencySmell[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const applicable = EFFICIENCY_PATTERNS.filter((p) => p.ext.test(f.path));
    if (applicable.length === 0) continue;
    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const window = lines.slice(i, i + 6).join('\n');
      for (const p of applicable) {
        if (p.pattern.test(window)) {
          const key = `${p.type}:${f.path}:${i}`;
          if (seen.has(key)) continue;
          seen.add(key);
          smells.push({ file: f.path, line: i + 1, type: p.type, snippet: lines[i].trim().slice(0, 140) });
        }
      }
    }
  }
  return smells.slice(0, 80);
}

// ── Accessibility (markup files only) ─────────────────────────────────────────
function analyzeAccessibility(files: RepoFile[]): CodeHealthReport['accessibility'] {
  const markup = files.filter((f) => MARKUP_EXT.test(f.path) && !/\.(min)\./i.test(f.path));
  if (markup.length === 0) {
    return { applicable: false, score: null, grade: null, htmlFilesScanned: 0, findings: [] };
  }

  const findings: A11yFinding[] = [];
  const add = (file: string, line: number, type: string, detail: string) =>
    findings.push({ file, line, type, detail });

  for (const f of markup) {
    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // <img> without alt
      const imgs = line.match(/<img\b[^>]*>/gi) ?? [];
      for (const img of imgs) {
        if (!/\balt\s*=/.test(img)) add(f.path, i + 1, 'Image missing alt', '<img> has no alt attribute.');
      }
      // <html> without lang
      const html = line.match(/<html\b[^>]*>/i);
      if (html && !/\blang\s*=/.test(html[0])) add(f.path, i + 1, 'Missing lang attribute', '<html> has no lang attribute.');
      // input without label/aria (heuristic: input with no aria-label/aria-labelledby/id, not hidden)
      const inputs = line.match(/<input\b[^>]*>/gi) ?? [];
      for (const inp of inputs) {
        if (/type\s*=\s*["']?(hidden|submit|button|reset)/i.test(inp)) continue;
        if (!/\b(aria-label|aria-labelledby|id|title)\s*=/.test(inp)) {
          add(f.path, i + 1, 'Input without accessible name', '<input> has no label association (aria-label/id/title).');
        }
      }
      // positive tabindex
      if (/tabindex\s*=\s*["']?[1-9]/.test(line)) add(f.path, i + 1, 'Positive tabindex', 'Positive tabindex disrupts natural tab order.');
      // onClick on non-interactive element (JSX/Vue)
      if (/<(div|span|li|p)\b[^>]*\bon[Cc]lick\b/.test(line) && !/role\s*=/.test(line)) {
        add(f.path, i + 1, 'Click handler on non-interactive element', 'Use a <button> or add role + keyboard handler.');
      }
      // anchor without href
      const anchors = line.match(/<a\b[^>]*>/gi) ?? [];
      for (const a of anchors) {
        if (!/\bhref\s*=/.test(a)) add(f.path, i + 1, 'Anchor without href', '<a> without href is not keyboard-focusable; use a <button>.');
      }
    }
  }

  // Score: penalize by finding density across scanned markup files.
  let score = 100;
  score -= Math.min(60, findings.length * 3);
  score = Math.max(0, score);

  return {
    applicable: true,
    score,
    grade: gradeFromScore(score),
    htmlFilesScanned: markup.length,
    findings: findings.slice(0, 80),
  };
}

export function analyzeCodeHealth(files: RepoFile[]): CodeHealthReport {
  return {
    quality: analyzeQuality(files),
    efficiency: { smells: analyzeEfficiency(files) },
    accessibility: analyzeAccessibility(files),
  };
}

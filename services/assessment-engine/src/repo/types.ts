import type { CveFinding } from '../security/cve.js';
import type { CodeHealthReport } from './codeHealth.js';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface RepoFile {
  path: string;
  content: string;
  size: number;
}

export interface RepoFetchResult {
  owner: string;
  repo: string;
  branch: string;
  defaultBranch: string;
  files: RepoFile[];
  truncated: boolean;       // GitHub truncated the tree (very large repo)
  source: 'api' | 'clone';
  /** Full `git log -p` patch text — only present in advanced (clone) mode. */
  historyPatch?: string;
  historyCommits?: number;
}

export interface SecretFinding {
  file: string;
  line: number;
  type: string;
  severity: Severity;
  match: string;          // redacted/partial preview
  inHistory: boolean;     // true if found only in git history, not current tree
}

export interface DependencyFinding {
  manifest: string;
  ecosystem: string;
  package: string;
  version: string;
  approximate: boolean;   // version was a range (from package.json, not a lock file)
  cves: CveFinding[];
}

export interface HygieneFinding {
  severity: Severity;
  finding: string;
  detail: string;
}

export interface WorkflowFinding {
  file: string;
  severity: Severity;
  issue: string;
  detail: string;
}

export interface CodePatternFinding {
  file: string;
  line: number;
  severity: Severity;
  type: string;
  snippet: string;
}

export interface RepoAnalysisResult {
  repo: { owner: string; repo: string; branch: string; url: string };
  mode: 'basic' | 'advanced';
  source: 'api' | 'clone';
  fileCount: number;
  truncated: boolean;
  historyCommits?: number;
  secrets: SecretFinding[];
  dependencies: DependencyFinding[];
  hygiene: HygieneFinding[];
  workflows: WorkflowFinding[];
  codePatterns: CodePatternFinding[];
  /** Code quality / efficiency / accessibility scores (shown in both scan modes). */
  codeHealth: CodeHealthReport;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  warnings: string[];
}

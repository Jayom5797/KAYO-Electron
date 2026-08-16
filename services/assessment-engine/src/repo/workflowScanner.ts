import type { RepoFile, WorkflowFinding } from './types.js';

/**
 * Lightweight (regex-based, not full YAML) analysis of GitHub Actions workflows.
 * Flags the most common, high-impact misconfigurations.
 */
export function scanWorkflows(files: RepoFile[]): WorkflowFinding[] {
  const workflows = files.filter((f) => /(^|\/)\.github\/workflows\/.+\.ya?ml$/i.test(f.path));
  const findings: WorkflowFinding[] = [];

  for (const wf of workflows) {
    const content = wf.content;

    // pull_request_target — runs with write token + secrets on untrusted PR code
    if (/\bpull_request_target\b/.test(content)) {
      findings.push({
        file: wf.path, severity: 'high',
        issue: 'Uses pull_request_target trigger',
        detail: 'pull_request_target runs with repository secrets and a write token in the context of untrusted PR code. If it checks out and runs PR code, attackers can exfiltrate secrets.',
      });
    }

    // Script injection via untrusted ${{ github.event.* }} in run: steps
    if (/run:\s*[\s\S]{0,400}?\$\{\{\s*github\.event\.(?:issue\.title|issue\.body|pull_request\.title|pull_request\.body|comment\.body|head_ref|head\.ref|head\.label)/.test(content)) {
      findings.push({
        file: wf.path, severity: 'high',
        issue: 'Possible script injection via untrusted event data',
        detail: 'A run: step interpolates attacker-controllable github.event data directly into the shell. Pass it through an env: var and quote it instead.',
      });
    }

    // Unpinned third-party actions (using a tag/branch instead of a commit SHA)
    const usesRe = /uses:\s*([^\s@]+)@([^\s#]+)/g;
    let m: RegExpExecArray | null;
    const unpinned = new Set<string>();
    while ((m = usesRe.exec(content)) !== null) {
      const action = m[1];
      const ref = m[2];
      // Skip first-party actions and local actions
      if (action.startsWith('./') || action.startsWith('actions/') || action.startsWith('github/')) continue;
      // A 40-char hex ref is a pinned SHA — safe
      if (/^[0-9a-f]{40}$/i.test(ref)) continue;
      unpinned.add(`${action}@${ref}`);
    }
    if (unpinned.size > 0) {
      findings.push({
        file: wf.path, severity: 'medium',
        issue: `Unpinned third-party action(s): ${Array.from(unpinned).slice(0, 5).join(', ')}`,
        detail: 'Third-party actions referenced by tag/branch can be moved to malicious code. Pin to a full commit SHA.',
      });
    }

    // Overly broad permissions
    if (/permissions:\s*write-all/.test(content)) {
      findings.push({
        file: wf.path, severity: 'medium',
        issue: 'Workflow grants permissions: write-all',
        detail: 'Grant the minimum token permissions needed. write-all gives the workflow token broad write access to the repo.',
      });
    }

    // Self-hosted runners on public repos can be abused by forks
    if (/runs-on:\s*\[?\s*self-hosted/.test(content)) {
      findings.push({
        file: wf.path, severity: 'low',
        issue: 'Uses a self-hosted runner',
        detail: 'On public repositories, self-hosted runners can be compromised by malicious pull requests. Ensure forked-PR workflows do not run on them.',
      });
    }
  }

  return findings;
}

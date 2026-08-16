import type { ReportInput, NetworkRequest } from './types.js';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function truncateUrl(url: string, maxLen: number = 80): string {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen - 1) + '…';
}

function statusCell(req: NetworkRequest): string {
  if (req.failed) return 'FAILED';
  return req.statusCode !== null ? String(req.statusCode) : '-';
}

function requestTable(requests: NetworkRequest[]): string {
  const header = '| URL | Method | Type | Status | Size | TTFB | Duration |\n|---|---|---|---|---|---|---|';
  const rows = requests.map((r) =>
    `| ${truncateUrl(r.url)} | ${r.method} | ${r.resourceType} | ${statusCell(r)} | ${formatBytes(r.sizeBytes)} | ${r.ttfbMs.toFixed(0)}ms | ${r.durationMs.toFixed(0)}ms |`
  );
  return [header, ...rows].join('\n');
}

export function renderReport(input: ReportInput): string {
  const { url, captureTimestamp, totalDurationMs, data } = input;
  const { aggregate, byType, slowest, errors, requests } = data;

  const sections: string[] = [];

  // Summary
  sections.push(`## Summary

| Field | Value |
|---|---|
| URL | ${url} |
| Captured | ${captureTimestamp} |
| Total Requests | ${aggregate.totalRequests} |
| Total Transferred | ${formatBytes(aggregate.totalBytes)} |
| Page Load Duration | ${totalDurationMs.toFixed(0)}ms |`);

  // Request Breakdown by Type
  const typeRows = byType
    .map((t) => `| ${t.resourceType} | ${t.count} | ${formatBytes(t.totalBytes)} | ${t.avgDurationMs.toFixed(0)}ms |`)
    .join('\n');
  sections.push(`## Request Breakdown by Type

| Type | Count | Total Size | Avg Duration |
|---|---|---|---|
${typeRows}`);

  // Slowest Requests
  sections.push(`## Slowest Requests

${requestTable(slowest)}`);

  // Errors and Failed Requests
  const errorContent = errors.length > 0
    ? requestTable(errors)
    : '_No errors or failed requests._';
  sections.push(`## Errors and Failed Requests

${errorContent}`);

  // Full Request Log
  sections.push(`## Full Request Log

${requestTable(requests)}`);

  return `# Network Analysis Report\n\n${sections.join('\n\n')}`;
}

// ─── Security report rendering (shared by CLI and web dashboard) ──────────────
import { computePosture, type SecurityFindings } from './analyze.js';

function severityCount(items: Array<{ severity?: string; riskLevel?: string }>): string {
  const counts: Record<string, number> = {};
  for (const i of items) {
    const s = i.severity ?? i.riskLevel ?? 'info';
    counts[s] = (counts[s] ?? 0) + 1;
  }
  const order = ['critical', 'high', 'medium', 'low', 'info'];
  const parts = order.filter((s) => counts[s]).map((s) => `${counts[s]} ${s}`);
  return parts.length ? parts.join(', ') : 'none';
}

/**
 * Renders the security analysis as a Markdown section. Kept intentionally
 * concise (grades + counts + the findings that matter) so it works well on the
 * CLI while still being a real security report — not just performance data.
 */
export function renderSecuritySection(sec: SecurityFindings): string {
  const out: string[] = ['# Security Analysis'];

  // ── Overall security posture ─────────────────────────────────────────────────
  const posture = computePosture(sec);
  out.push(`## Overall Security Posture

**Rating: ${posture.rating}** — risk score ${posture.score}/100 (higher is safer)

| Critical | High | Medium | Low |
|---|---|---|---|
| ${posture.counts.critical} | ${posture.counts.high} | ${posture.counts.medium} | ${posture.counts.low} |`);

  // ── Grades summary ──────────────────────────────────────────────────────────
  const tlsGrade = sec.tls && !('error' in sec.tls) ? sec.tls.grade : 'n/a';
  const cspGrade = sec.csp?.grade ?? 'n/a';
  out.push(`## Grades

| Area | Grade |
|---|---|
| TLS / HTTPS | ${tlsGrade} |
| Content-Security-Policy | ${cspGrade}${sec.csp ? ` (${sec.csp.score}/100)` : ''} |`);

  // ── TLS ──────────────────────────────────────────────────────────────────────
  if (sec.tls && !('error' in sec.tls)) {
    const tls = sec.tls;
    const rows = tls.issues.length
      ? tls.issues.map((i) => `| ${i.severity} | ${i.issue} |`).join('\n')
      : '| — | No TLS issues found |';
    out.push(`## TLS / Certificate

Protocol: ${tls.protocol} · Cipher: ${tls.cipher} (${tls.cipherBits}-bit) · Cert expires in ${tls.cert.daysUntilExpiry} days · HSTS: ${tls.hstsPresent ? 'yes' : 'no'}

| Severity | Issue |
|---|---|
${rows}`);
  } else if (sec.tls && 'error' in sec.tls) {
    out.push(`## TLS / Certificate\n\n_TLS inspection unavailable: ${sec.tls.error}_`);
  }

  // ── CSP + security headers + cookies ─────────────────────────────────────────
  if (sec.csp) {
    const rows = sec.csp.issues.length
      ? sec.csp.issues.map((i) => `| ${i.severity} | ${i.issue} |`).join('\n')
      : '| — | No CSP issues found |';
    out.push(`## Content-Security-Policy

| Severity | Issue |
|---|---|
${rows}`);
  }

  if (sec.securityHeaders.length) {
    out.push(`## Missing / Weak Security Headers

| Severity | Header | Issue |
|---|---|---|
${sec.securityHeaders.map((h) => `| ${h.severity} | ${h.header} | ${h.issue} |`).join('\n')}`);
  }

  if (sec.cookieIssues.length) {
    out.push(`## Insecure Cookies (${severityCount(sec.cookieIssues)})

| Severity | Cookie | Issue |
|---|---|---|
${sec.cookieIssues.map((c) => `| ${c.severity} | ${c.name} | ${c.issue} |`).join('\n')}`);
  }

  // ── CORS ──────────────────────────────────────────────────────────────────────
  const corsFindings = 'findings' in sec.cors ? sec.cors.findings : [];
  if (corsFindings.length) {
    out.push(`## CORS (${severityCount(corsFindings)})

| Risk | Issue | URL |
|---|---|---|
${corsFindings.map((f) => `| ${f.riskLevel} | ${f.issue} | ${truncateUrl(f.url, 60)} |`).join('\n')}`);
  }

  // ── Mixed content ─────────────────────────────────────────────────────────────
  if (sec.mixedContent.present) {
    out.push(`## Mixed Content (${severityCount(sec.mixedContent.findings)})

| Severity | Type | URL |
|---|---|---|
${sec.mixedContent.findings.map((f) => `| ${f.severity} | ${f.category}/${f.resourceType} | ${truncateUrl(f.url, 60)} |`).join('\n')}`);
  }

  // ── Fingerprint + CVEs + third parties ───────────────────────────────────────
  if (sec.fingerprint) {
    const fp = sec.fingerprint;
    if (fp.technologies.length) {
      const server = [fp.serverSoftware, fp.poweredBy].filter(Boolean).join(' · ');
      out.push(`## Detected Technologies${server ? `\n\nServer: ${server}` : ''}

${fp.technologies.map((t) => `- ${t.name}${t.version ? ` ${t.version}` : ''} (${t.category})`).join('\n')}`);
    }
    const cves = (fp as { cves?: Array<{ component: string; id: string; severity: string }> }).cves ?? [];
    if (cves.length) {
      out.push(`## Known Vulnerabilities (CVE)

| Component | Advisory | Severity |
|---|---|---|
${cves.map((c) => `| ${c.component} | ${c.id} | ${c.severity} |`).join('\n')}`);
    }
    // CMS attack surface (WordPress xmlrpc, user enumeration, version disclosure, …)
    if (fp.cmsExposure?.length) {
      out.push(`## CMS Attack Surface (${severityCount(fp.cmsExposure)})

| Severity | CMS | Finding | Detail |
|---|---|---|---|
${fp.cmsExposure
  .map((c) => `| ${c.severity} | ${c.cms} | ${c.finding} | ${c.detail} |`)
  .join('\n')}`);
    }
    if (fp.thirdPartyDomains?.length) {
      out.push(`## Third-Party Domains (${fp.thirdPartyDomains.length})

| Domain | Category | Requests |
|---|---|---|
${fp.thirdPartyDomains
  .map((d) => `| ${d.domain} | ${d.category || '—'} | ${d.requestCount} |`)
  .join('\n')}`);
    }
  }

  // ── API endpoint inventory ───────────────────────────────────────────────────
  if (sec.api.length) {
    out.push(`## API Endpoints (${sec.api.length})

| Method | Path | Auth | Status |
|---|---|---|---|
${sec.api
  .slice(0, 50)
  .map(
    (e) =>
      `| ${e.method} | ${truncateUrl(e.path, 50)} | ${e.hasAuth ? e.authType || 'yes' : '—'} | ${e.statusCode ?? '—'} |`
  )
  .join('\n')}`);
  }

  // ── Decoded JWTs ─────────────────────────────────────────────────────────────
  const jwtRows = sec.api.flatMap((e) =>
    e.jwts.map((j) => {
      const alg = String((j.header as { alg?: unknown }).alg ?? '?');
      const p = j.payload as Record<string, unknown>;
      const claims = ['sub', 'iss', 'aud', 'exp']
        .filter((k) => p[k] !== undefined)
        .map((k) => `${k}=${String(p[k])}`)
        .join(', ');
      return `| ${alg} | ${truncateUrl(e.url, 40)} | ${claims || '—'} |`;
    })
  );
  if (jwtRows.length) {
    out.push(`## Decoded JWTs (${jwtRows.length})

| Alg | Endpoint | Claims |
|---|---|---|
${jwtRows.join('\n')}`);
  }

  // ── API endpoints with leaks ─────────────────────────────────────────────────
  const leakyEndpoints = sec.api.filter((e) => e.sensitiveLeaks.length > 0);
  if (leakyEndpoints.length) {
    const rows = leakyEndpoints.flatMap((e) =>
      e.sensitiveLeaks.map((l) => `| ${l.type} | ${l.location} | ${l.reason} | ${truncateUrl(e.url, 40)} |`)
    );
    out.push(`## Sensitive Data Exposure

| Type | Location | Why it's a leak | Endpoint |
|---|---|---|---|
${rows.join('\n')}`);
  }

  // ── DNS information ───────────────────────────────────────────────────────────
  if (sec.dns) {
    if (sec.dns.subdomains.length) {
      out.push(`## Discovered Subdomains

${sec.dns.subdomains.map((s) => `- ${s}`).join('\n')}`);
    }
    const domainsWithRecords = sec.dns.domains.filter((d) => d.records.length > 0);
    if (domainsWithRecords.length) {
      const rows = domainsWithRecords.flatMap((d) =>
        d.records.slice(0, 12).map((r) => `| ${d.domain} | ${r.type} | ${r.value} |`)
      );
      out.push(`## DNS Records

| Domain | Type | Value |
|---|---|---|
${rows.join('\n')}`);
    }
  }

  // ── Active vulnerability scan ─────────────────────────────────────────────────
  if (!('skipped' in sec.vuln && sec.vuln.skipped)) {
    const v = sec.vuln.findings;
    const all = [
      ...v.sqli, ...v.xss, ...v.idor, ...v.pathTraversal, ...v.openRedirect, ...v.infoDisclosure,
    ];
    if (all.length) {
      out.push(`## Active Vulnerability Findings (${severityCount(all)})

| Severity | Type | URL |
|---|---|---|
${all.map((f) => `| ${f.severity} | ${f.type} | ${truncateUrl(f.url, 50)} |`).join('\n')}`);
    } else {
      out.push(`## Active Vulnerability Findings\n\n_Active scan ran against ${sec.vuln.scannedEndpoints} endpoint(s); no vulnerabilities detected._`);
    }
  }

  return out.join('\n\n');
}

// ─── GitHub repository report rendering ───────────────────────────────────────
import type { RepoAnalysisResult } from './repo/types.js';

function mdEscape(s: string): string {
  // Escape pipes and backticks so finding text can't break Markdown tables.
  return String(s ?? '').replace(/\|/g, '\\|').replace(/`/g, '\u200b`').replace(/\n/g, ' ');
}

/**
 * Renders a complete GitHub repository analysis as a Markdown report containing
 * every finding: secrets, vulnerable dependencies, workflow risks, hygiene,
 * insecure code patterns, and the code-health (quality/efficiency/a11y) report.
 */
export function renderRepoReport(result: RepoAnalysisResult): string {
  const out: string[] = [];
  const {
    repo, mode, source, fileCount, truncated, historyCommits,
    secrets, dependencies, hygiene, workflows, codePatterns, codeHealth, summary, warnings,
  } = result;

  out.push(`# Repository Security Report — ${repo.owner}/${repo.repo}`);

  out.push(`## Overview

| Field | Value |
|---|---|
| Repository | ${repo.url} |
| Branch | ${repo.branch} |
| Scan mode | ${mode} (${source}) |
| Files scanned | ${fileCount}${truncated ? ' (truncated)' : ''} |
| History commits scanned | ${historyCommits ?? 'n/a'} |`);

  out.push(`## Findings Summary

| Severity | Count |
|---|---|
| 🔴 Critical | ${summary.critical} |
| 🟠 High | ${summary.high} |
| 🟡 Medium | ${summary.medium} |
| 🔵 Low | ${summary.low} |
| ⚪ Info | ${summary.info} |
| **Total** | **${summary.total}** |`);

  if (warnings.length) {
    out.push(`## Warnings\n\n${warnings.map((w) => `- ${mdEscape(w)}`).join('\n')}`);
  }

  // ── Secrets ───────────────────────────────────────────────────────────────
  out.push(`## Hardcoded Secrets (${secrets.length})`);
  if (secrets.length) {
    out.push(`| Severity | Type | File | Line | Match | Source |
|---|---|---|---|---|---|
${secrets
  .map(
    (s) =>
      `| ${s.severity} | ${mdEscape(s.type)} | ${mdEscape(s.file)} | ${s.line || '—'} | \`${mdEscape(s.match)}\` | ${s.inHistory ? 'git history' : 'current tree'} |`
  )
  .join('\n')}`);
  } else {
    out.push('_No hardcoded secrets detected._');
  }

  // ── Dependencies ──────────────────────────────────────────────────────────
  out.push(`## Vulnerable Dependencies (${dependencies.length})`);
  if (dependencies.length) {
    const rows: string[] = [];
    for (const d of dependencies) {
      for (const c of d.cves) {
        rows.push(
          `| ${c.severity} | ${mdEscape(d.package)} | ${mdEscape(d.version)}${d.approximate ? ' (approx)' : ''} | ${mdEscape(d.ecosystem)} | ${mdEscape(c.id)} | ${mdEscape(c.summary)} |`
        );
      }
    }
    out.push(`| Severity | Package | Version | Ecosystem | Advisory | Summary |
|---|---|---|---|---|---|
${rows.join('\n')}`);
  } else {
    out.push('_No known-vulnerable dependencies found._');
  }

  // ── Workflows ─────────────────────────────────────────────────────────────
  out.push(`## GitHub Actions Workflow Risks (${workflows.length})`);
  if (workflows.length) {
    out.push(`| Severity | File | Issue | Detail |
|---|---|---|---|
${workflows
  .map((w) => `| ${w.severity} | ${mdEscape(w.file)} | ${mdEscape(w.issue)} | ${mdEscape(w.detail)} |`)
  .join('\n')}`);
  } else {
    out.push('_No workflow risks detected._');
  }

  // ── Hygiene ───────────────────────────────────────────────────────────────
  out.push(`## Repository Hygiene (${hygiene.length})`);
  if (hygiene.length) {
    out.push(`| Severity | Finding | Detail |
|---|---|---|
${hygiene
  .map((h) => `| ${h.severity} | ${mdEscape(h.finding)} | ${mdEscape(h.detail)} |`)
  .join('\n')}`);
  } else {
    out.push('_No hygiene issues detected._');
  }

  // ── Insecure code patterns ────────────────────────────────────────────────
  out.push(`## Insecure Code Patterns (${codePatterns.length})`);
  if (codePatterns.length) {
    out.push(`| Severity | Type | File | Line | Snippet |
|---|---|---|---|---|
${codePatterns
  .map(
    (c) =>
      `| ${c.severity} | ${mdEscape(c.type)} | ${mdEscape(c.file)} | ${c.line} | \`${mdEscape(c.snippet)}\` |`
  )
  .join('\n')}`);
  } else {
    out.push('_No insecure code patterns detected._');
  }

  // ── Code health ───────────────────────────────────────────────────────────
  const q = codeHealth.quality;
  out.push(`## Code Health

### Quality — grade ${q.grade} (${q.score}/100)

| Metric | Value |
|---|---|
| Files analyzed | ${q.metrics.filesAnalyzed} |
| Avg file length | ${q.metrics.avgFileLines} lines |
| Large files (>400 lines) | ${q.metrics.largeFiles} |
| Deeply nested lines | ${q.metrics.deeplyNested} |
| TODO/FIXME markers | ${q.metrics.todoCount} |
| Comment ratio | ${(q.metrics.commentRatio * 100).toFixed(0)}% |
| Has tests | ${q.metrics.hasTests ? 'yes' : 'no'} |
| Has linter | ${q.metrics.hasLinter ? 'yes' : 'no'} |
| Has CI | ${q.metrics.hasCI ? 'yes' : 'no'} |
| Has type checking | ${q.metrics.hasTypeChecking ? 'yes' : 'no'} |`);

  if (q.smells.length) {
    out.push(`**Quality smells:**\n\n${q.smells
      .map((s) => `- ${mdEscape(s.file)}: ${mdEscape(s.type)} — ${mdEscape(s.detail)}`)
      .join('\n')}`);
  }

  const eff = codeHealth.efficiency.smells;
  out.push(`### Efficiency (${eff.length} finding${eff.length === 1 ? '' : 's'})`);
  if (eff.length) {
    out.push(`| Type | File | Line | Snippet |
|---|---|---|---|
${eff
  .map((s) => `| ${mdEscape(s.type)} | ${mdEscape(s.file)} | ${s.line} | \`${mdEscape(s.snippet)}\` |`)
  .join('\n')}`);
  } else {
    out.push('_No efficiency concerns detected._');
  }

  const a11y = codeHealth.accessibility;
  if (!a11y.applicable) {
    out.push('### Accessibility\n\n_Not applicable — no front-end markup found._');
  } else {
    out.push(`### Accessibility — grade ${a11y.grade} (${a11y.score}/100)

Scanned ${a11y.htmlFilesScanned} markup file(s).`);
    if (a11y.findings.length) {
      out.push(`| Type | File | Line | Detail |
|---|---|---|---|
${a11y.findings
  .map((f) => `| ${mdEscape(f.type)} | ${mdEscape(f.file)} | ${f.line} | ${mdEscape(f.detail)} |`)
  .join('\n')}`);
    } else {
      out.push('_No accessibility issues detected._');
    }
  }

  return out.join('\n\n');
}

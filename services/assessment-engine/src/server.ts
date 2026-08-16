/**
 * KAYO Assessment Engine — HTTP API Server
 *
 * Wraps ASTRA's security analysis modules behind a RESTful API
 * for integration with the KAYO control plane.
 *
 * Endpoints:
 *   POST /assess/url          — Run URL security assessment
 *   POST /assess/repository   — Run repository security assessment
 *   GET  /assess/:scanId      — Get scan status/result
 *   GET  /assess/:scanId/findings — Get findings for a scan
 *   GET  /assess/:scanId/report   — Get formatted report
 *   GET  /health              — Health check
 */
import express from 'express';
import { randomUUID } from 'node:crypto';
import { runScan, type ScanOptions } from './analyze.js';
import { analyzeRepo } from './repo/index.js';
import { renderSecuritySection, renderRepoReport } from './report.js';
import { computePosture, type SecurityFindings } from './analyze.js';
import { validateSsrf } from './ssrf-guard.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

// ── In-memory scan store (production: use PostgreSQL via control-plane) ───────
interface ScanRecord {
  scan_id: string;
  tenant_id: string;
  type: 'url' | 'repository';
  target: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at: string | null;
  result: any | null;
  error: string | null;
}

const scans = new Map<string, ScanRecord>();

// ── Auth middleware (validates internal service token) ─────────────────────────
const SERVICE_TOKEN = process.env.KAYO_SERVICE_TOKEN || 'dev-token';

app.use((req, res, next) => {
  // Health check is unauthenticated
  if (req.path === '/health') return next();

  const token = req.header('x-kayo-service-token') ?? req.header('authorization')?.replace('Bearer ', '');
  if (token !== SERVICE_TOKEN) {
    res.status(401).json({ error: 'Unauthorized: invalid service token' });
    return;
  }
  next();
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'assessment-engine', version: '1.0.0' });
});

// ── POST /assess/url ──────────────────────────────────────────────────────────
app.post('/assess/url', async (req, res) => {
  const { url, tenant_id, active_scan = false, timeout_ms = 30000 } = req.body as {
    url?: string;
    tenant_id?: string;
    active_scan?: boolean;
    timeout_ms?: number;
  };

  if (!url) {
    res.status(400).json({ error: 'url is required' });
    return;
  }
  if (!tenant_id) {
    res.status(400).json({ error: 'tenant_id is required' });
    return;
  }

  // SSRF protection — block private/internal IPs and metadata endpoints
  const ssrfCheck = validateSsrf(url);
  if (!ssrfCheck.safe) {
    res.status(403).json({ error: `SSRF blocked: ${ssrfCheck.reason}` });
    return;
  }

  const scan_id = randomUUID();
  const record: ScanRecord = {
    scan_id,
    tenant_id,
    type: 'url',
    target: url,
    status: 'pending',
    started_at: new Date().toISOString(),
    completed_at: null,
    result: null,
    error: null,
  };
  scans.set(scan_id, record);

  // Run scan asynchronously
  record.status = 'running';
  runScan(url, { activeScan: active_scan, timeoutMs: timeout_ms })
    .then((result) => {
      record.status = 'completed';
      record.completed_at = new Date().toISOString();
      record.result = result;
    })
    .catch((err) => {
      record.status = 'failed';
      record.completed_at = new Date().toISOString();
      record.error = err instanceof Error ? err.message : String(err);
    });

  res.status(202).json({
    scan_id,
    status: 'running',
    message: 'URL assessment started',
  });
});

// ── POST /assess/repository ───────────────────────────────────────────────────
app.post('/assess/repository', async (req, res) => {
  const { url, tenant_id, advanced = false, token } = req.body as {
    url?: string;
    tenant_id?: string;
    advanced?: boolean;
    token?: string;
  };

  if (!url) {
    res.status(400).json({ error: 'url is required' });
    return;
  }
  if (!tenant_id) {
    res.status(400).json({ error: 'tenant_id is required' });
    return;
  }

  const scan_id = randomUUID();
  const record: ScanRecord = {
    scan_id,
    tenant_id,
    type: 'repository',
    target: url,
    status: 'pending',
    started_at: new Date().toISOString(),
    completed_at: null,
    result: null,
    error: null,
  };
  scans.set(scan_id, record);

  record.status = 'running';
  analyzeRepo(url, { advanced, token: token ?? process.env.GITHUB_TOKEN })
    .then((result) => {
      record.status = 'completed';
      record.completed_at = new Date().toISOString();
      record.result = result;
    })
    .catch((err) => {
      record.status = 'failed';
      record.completed_at = new Date().toISOString();
      record.error = err instanceof Error ? err.message : String(err);
    });

  res.status(202).json({
    scan_id,
    status: 'running',
    message: 'Repository assessment started',
  });
});

// ── GET /assess/:scanId ───────────────────────────────────────────────────────
app.get('/assess/:scanId', (req, res) => {
  const record = scans.get(req.params.scanId);
  if (!record) {
    res.status(404).json({ error: 'Scan not found' });
    return;
  }

  const posture = record.result?.posture ?? null;

  res.json({
    scan_id: record.scan_id,
    tenant_id: record.tenant_id,
    type: record.type,
    target: record.target,
    status: record.status,
    started_at: record.started_at,
    completed_at: record.completed_at,
    posture,
    error: record.error,
  });
});

// ── GET /assess/:scanId/findings ──────────────────────────────────────────────
app.get('/assess/:scanId/findings', (req, res) => {
  const record = scans.get(req.params.scanId);
  if (!record) {
    res.status(404).json({ error: 'Scan not found' });
    return;
  }
  if (record.status !== 'completed') {
    res.status(409).json({ error: `Scan is ${record.status}` });
    return;
  }

  // Transform ASTRA results into canonical KAYO findings
  const findings = extractFindings(record);
  res.json({ scan_id: record.scan_id, findings });
});

// ── GET /assess/:scanId/report ────────────────────────────────────────────────
app.get('/assess/:scanId/report', (req, res) => {
  const record = scans.get(req.params.scanId);
  if (!record) {
    res.status(404).json({ error: 'Scan not found' });
    return;
  }
  if (record.status !== 'completed') {
    res.status(409).json({ error: `Scan is ${record.status}` });
    return;
  }

  const format = (req.query.format as string) || 'markdown';

  if (record.type === 'url') {
    const report = renderSecuritySection(record.result);
    res.json({ scan_id: record.scan_id, format, content: report });
  } else {
    const report = renderRepoReport(record.result);
    res.json({ scan_id: record.scan_id, format, content: report });
  }
});

// ── Finding extraction ────────────────────────────────────────────────────────

interface Finding {
  finding_id: string;
  type: string;
  severity: string;
  category: string;
  description: string;
  endpoint?: string;
  evidence?: string;
  remediation?: string;
}

function extractFindings(record: ScanRecord): Finding[] {
  const findings: Finding[] = [];
  const r = record.result;
  if (!r) return findings;

  if (record.type === 'url') {
    // TLS issues
    if (r.tls && !('error' in r.tls)) {
      for (const issue of r.tls.issues ?? []) {
        findings.push({
          finding_id: randomUUID(),
          type: 'tls',
          severity: issue.severity,
          category: 'TLS/Certificate',
          description: issue.issue,
          endpoint: record.target,
        });
      }
    }

    // CSP issues
    if (r.csp?.issues) {
      for (const issue of r.csp.issues) {
        findings.push({
          finding_id: randomUUID(),
          type: 'csp',
          severity: issue.severity,
          category: 'Content-Security-Policy',
          description: issue.issue,
          endpoint: record.target,
        });
      }
    }

    // Security headers
    for (const h of r.securityHeaders ?? []) {
      findings.push({
        finding_id: randomUUID(),
        type: 'missing_header',
        severity: h.severity,
        category: 'Security Headers',
        description: `${h.header}: ${h.issue}`,
        endpoint: record.target,
      });
    }

    // Cookie issues
    for (const c of r.cookieIssues ?? []) {
      findings.push({
        finding_id: randomUUID(),
        type: 'insecure_cookie',
        severity: c.severity,
        category: 'Cookies',
        description: `Cookie '${c.name}': ${c.issue}`,
        endpoint: record.target,
      });
    }

    // CORS
    const corsFindings = 'findings' in (r.cors ?? {}) ? r.cors.findings : [];
    for (const f of corsFindings) {
      findings.push({
        finding_id: randomUUID(),
        type: 'cors',
        severity: f.riskLevel,
        category: 'CORS',
        description: f.issue,
        endpoint: f.url,
      });
    }

    // Mixed content
    for (const f of r.mixedContent?.findings ?? []) {
      findings.push({
        finding_id: randomUUID(),
        type: 'mixed_content',
        severity: f.severity,
        category: 'Mixed Content',
        description: `${f.category}/${f.resourceType}: ${f.url}`,
        endpoint: f.url,
      });
    }

    // Sensitive data leaks
    for (const ep of r.api ?? []) {
      for (const leak of ep.sensitiveLeaks ?? []) {
        findings.push({
          finding_id: randomUUID(),
          type: 'sensitive_data',
          severity: 'high',
          category: 'Data Exposure',
          description: `${leak.type} in ${leak.location}: ${leak.reason}`,
          endpoint: ep.url,
        });
      }
    }

    // Active vuln findings
    if (r.vuln && !r.vuln.skipped) {
      const v = r.vuln.findings;
      const all = [...(v.sqli ?? []), ...(v.xss ?? []), ...(v.idor ?? []), ...(v.pathTraversal ?? []), ...(v.openRedirect ?? []), ...(v.infoDisclosure ?? [])];
      for (const f of all) {
        findings.push({
          finding_id: randomUUID(),
          type: f.type,
          severity: f.severity,
          category: 'Active Vulnerability',
          description: `${f.type} detected at ${f.url}`,
          endpoint: f.url,
        });
      }
    }
  } else if (record.type === 'repository') {
    // Secrets
    for (const s of r.secrets ?? []) {
      findings.push({
        finding_id: randomUUID(),
        type: 'hardcoded_secret',
        severity: s.severity,
        category: 'Secrets',
        description: `${s.type} in ${s.file}:${s.line}`,
        evidence: s.match,
      });
    }

    // Dependencies
    for (const d of r.dependencies ?? []) {
      for (const cve of d.cves) {
        findings.push({
          finding_id: randomUUID(),
          type: 'vulnerable_dependency',
          severity: cve.severity === 'unknown' ? 'low' : cve.severity,
          category: 'Dependencies',
          description: `${d.package}@${d.version}: ${cve.summary}`,
          evidence: cve.id,
        });
      }
    }

    // Workflow risks
    for (const w of r.workflows ?? []) {
      findings.push({
        finding_id: randomUUID(),
        type: 'workflow_risk',
        severity: w.severity,
        category: 'CI/CD',
        description: `${w.file}: ${w.issue}`,
        evidence: w.detail,
      });
    }

    // Code patterns
    for (const c of r.codePatterns ?? []) {
      findings.push({
        finding_id: randomUUID(),
        type: 'insecure_code',
        severity: c.severity,
        category: 'Code Security',
        description: `${c.type} in ${c.file}:${c.line}`,
        evidence: c.snippet,
      });
    }
  }

  return findings;
}

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3100);
const HOST = process.env.HOST ?? '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`KAYO Assessment Engine running at http://${HOST}:${PORT}`);
});

export { app };

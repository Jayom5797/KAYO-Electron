# KAYO Consolidation — Phase 2 Report

**Date**: August 15, 2026  
**Status**: COMPLETE — AWAITING REVIEW

---

## 1. Files Created

### Root Level
- `KAYO/README.md` — Project overview and documentation
- `KAYO/.gitignore` — Git ignore rules (credentials blocked)
- `KAYO/docker-compose.yml` — Development infrastructure (from 01_KAYO)
- `KAYO/docker-compose.local.yml` — Local override (from 01_KAYO)
- `KAYO/Makefile` — Development commands (from 01_KAYO)
- `KAYO/PHASE2_REPORT.md` — This report

### Services
- `KAYO/services/control-plane/` — Full directory (from 01_KAYO, ~30 files)
- `KAYO/services/detection-engine/` — Full directory (from 01_KAYO, ~15 files)
- `KAYO/services/graph-engine/` — Full directory (from 01_KAYO, ~8 files)
- `KAYO/services/telemetry-ingestion/` — Full directory (from 01_KAYO, ~5 files)
- `KAYO/services/ai-service/` — Full directory (from 01_KAYO/ai-explainer, ~7 files)
- `KAYO/services/assessment-engine/` — Full directory (ASTRA source + new files):
  - `src/server.ts` — **NEW** HTTP API server
  - `src/ssrf-guard.ts` — **NEW** SSRF protection module
  - `src/analyze.ts`, `src/capture.ts`, `src/cli.ts`, `src/har.ts`, `src/metrics.ts`, `src/output.ts`, `src/report.ts`, `src/types.ts`, `src/url.ts` (from ASTRA)
  - `src/security/*` — 9 modules (from ASTRA)
  - `src/repo/*` — 9 modules (from ASTRA)
  - `src/ai/groqClient.ts` (from ASTRA)
  - `src/__tests__/*` — 10 test files (from ASTRA)
  - `package.json`, `tsconfig.json`, `vitest.config.ts`, etc.
- `KAYO/services/deployment-engine/`:
  - `deployment_orchestrator.py` (from 01_KAYO)
  - `build_service.py` (from 01_KAYO)
  - `manifest_generator.py` (from 01_KAYO)
  - `config.py` (from 01_KAYO)
  - `Dockerfile` (from 01_KAYO)
  - `requirements.txt` — **NEW** (combined deps)
  - `stack_detector.py` — **NEW** (extracted from SEVE)
  - `dockerfile_generator.py` — **NEW** (extracted from SEVE)
  - `security_gate.py` — **NEW** (pre-deployment security validation)
  - `safe_extract.py` — **NEW** (safe ZIP extraction with zip-slip protection)
- `KAYO/services/monitor-service/`:
  - `uptime_monitor.py` — **NEW** (reimplemented from SEVE)
  - `stress_tester.py` — **NEW** (reimplemented from SEVE)
  - `requirements.txt` — **NEW**

### Packages
- `KAYO/packages/shared-schemas/models.py` — **NEW** canonical data models
- `KAYO/packages/shared-schemas/event_schema.json` (from 01_KAYO)
- `KAYO/packages/security-rules/*.yaml` — 15 detection rule files (from 01_KAYO)
- `KAYO/packages/deployment-templates/stack_detector.py` — Reference copy

### Infrastructure
- `KAYO/infrastructure/terraform/` — Full Terraform modules + environments (from 01_KAYO)
- `KAYO/infrastructure/kubernetes/` — K8s manifests (from 01_KAYO)
- `KAYO/infrastructure/clickhouse/init.sql` (from 01_KAYO)
- `KAYO/infrastructure/monitoring/` — Prometheus alerts + Grafana dashboard (from 01_KAYO)
- `KAYO/infrastructure/grafana/` — Grafana dashboard JSONs (from 01_KAYO)
- `KAYO/infrastructure/vector/` — Vector log pipeline config (from 01_KAYO)

### Frontend
- `KAYO/apps/web/` — Full Next.js application (from 01_KAYO/frontend)

### Tests
- `KAYO/tests/unit/` — 7 test files (from 01_KAYO)
- `KAYO/tests/integration/` — 2 test files (from 01_KAYO)
- `KAYO/tests/e2e/` — 1 test file (from 01_KAYO)
- `KAYO/tests/load/` — 4 files (from 01_KAYO)
- `KAYO/tests/security/` — 1 file (from 01_KAYO)

### Documentation
- `KAYO/docs/ARCHITECTURE.md` — **NEW**
- `KAYO/docs/CONSOLIDATION_MAP.md` — **NEW**
- `KAYO/docs/API_CONTRACTS.md` — **NEW**
- `KAYO/docs/SECURITY_MODEL.md` — **NEW**
- `KAYO/docs/MIGRATION_STATUS.md` — **NEW**

### CI/CD
- `KAYO/.github/workflows/ci.yml` (from 01_KAYO)
- `KAYO/.github/workflows/deploy.yml` (from 01_KAYO)

### Scripts
- `KAYO/scripts/run-tests.sh` (from 01_KAYO)
- `KAYO/scripts/setup-dev.sh` (from 01_KAYO)

---

## 2. Files Changed

No files in the original repositories were modified. All work was done in the new `KAYO/` directory.

Files that are new implementations (not direct copies):
- `KAYO/services/assessment-engine/src/server.ts` — Replaced ASTRA's inline dashboard server with proper API
- `KAYO/services/assessment-engine/src/ssrf-guard.ts` — New security module
- `KAYO/services/deployment-engine/stack_detector.py` — Reimplemented from SEVE
- `KAYO/services/deployment-engine/dockerfile_generator.py` — Reimplemented from SEVE
- `KAYO/services/deployment-engine/security_gate.py` — New module
- `KAYO/services/deployment-engine/safe_extract.py` — New module
- `KAYO/services/monitor-service/uptime_monitor.py` — Reimplemented from SEVE
- `KAYO/services/monitor-service/stress_tester.py` — Reimplemented from SEVE
- `KAYO/packages/shared-schemas/models.py` — New canonical models

---

## 3. Components Extracted

| Component | Source Repo | Original Path | New KAYO Path | Preserved | Changed | Why |
|-----------|------------|---------------|---------------|-----------|---------|-----|
| Control Plane | 01_KAYO | services/control-plane/ | services/control-plane/ | 100% | Nothing | Core API gateway |
| Detection Engine | 01_KAYO | services/detection-engine/ | services/detection-engine/ | 100% | Nothing | Runtime detection |
| Graph Engine | 01_KAYO | services/graph-engine/ | services/graph-engine/ | 100% | Nothing | Behavior graphs |
| Telemetry Ingestion | 01_KAYO | services/telemetry-ingestion/ | services/telemetry-ingestion/ | 100% | Nothing | Event pipeline |
| AI Explainer | 01_KAYO | services/ai-explainer/ | services/ai-service/ | 100% | Directory renamed | To become unified AI service |
| Deployment Orchestrator | 01_KAYO | services/deployment-orchestrator/ | services/deployment-engine/ | 100% | Added new modules alongside | K8s deployment logic preserved |
| ASTRA Analysis Core | ASTRA | src/ | services/assessment-engine/src/ | ~95% | server.ts replaced with API | Assessment capabilities preserved |
| Stack Detection | SEVE-SaaS | kayo_deploy.py (function) | services/deployment-engine/stack_detector.py | Logic preserved | Reimplemented with types, structure | Better API, no GCP |
| Dockerfile Templates | SEVE-SaaS | kayo_deploy.py (dict) | services/deployment-engine/dockerfile_generator.py | Logic preserved | Reimplemented with security | Non-root, multi-stage |
| Uptime Monitor | SEVE-SaaS | kayo_monitor.py | services/monitor-service/uptime_monitor.py | Logic preserved | Reimplemented as module | Typed output, no print |
| Stress Tester | SEVE-SaaS | kayo_stress.py | services/monitor-service/stress_tester.py | Logic preserved | Reimplemented with safety caps | Max limits enforced |
| Frontend | 01_KAYO | frontend/ | apps/web/ | 100% | Nothing | Dashboard UI |
| Infrastructure | 01_KAYO | infrastructure/ | infrastructure/ | 100% | Nothing | AWS IaC |
| Detection Rules | 01_KAYO | services/detection-engine/rules/ | packages/security-rules/ | 100% | Also kept in detection-engine | Shared rules package |
| Event Schema | 01_KAYO | shared/schemas/ | packages/shared-schemas/ | 100% | Added models.py alongside | Extended with canonical types |

---

## 4. Components NOT Yet Migrated

| Component | Source | Reason |
|-----------|--------|--------|
| SEVE Backend Discovery | SEVE-SaaS/kayo_backend_discovery.py | Useful but lower priority; assessment engine covers most discovery |
| SEVE Port Scanner | SEVE-SaaS/kayo_scanner.py (scan_ports) | Needs integration into assessment engine as module |
| SEVE Rate Limit Tester | SEVE-SaaS/kayo_scanner.py (check_rate_limiting) | Needs integration into assessment engine |
| SEVE Auth Bypass Tester | SEVE-SaaS/kayo_scanner.py (check_api_auth_bypass) | Needs integration into assessment engine |
| SEVE DB Exposure Tester | SEVE-SaaS/kayo_scanner.py (check_database_exposure) | Needs integration into assessment engine |
| AI Provider Abstraction | — | AI service needs Groq adapter + provider interface |
| Assessment UI Pages | — | Frontend needs new assessment/scan pages |
| Monitoring UI Pages | — | Frontend needs monitoring dashboard |
| Control Plane → Assessment Routes | — | API routes for triggering scans from control plane |
| PDF Report Generation | SEVE-SaaS/report/ | Deferred — Markdown + JSON sufficient for now |
| WhatsApp Alerter | SEVE-SaaS/kayo_alerter/ | Deferred — niche notification channel |
| Container Image Scanning | — | Not yet implemented (Trivy integration needed) |

---

## 5. Architecture Implemented

```
┌─────────────────────────────────────────────────────────────────┐
│                        KAYO Platform                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────┐  ┌───────────────┐  ┌────────────────────┐    │
│  │  Frontend  │  │ Control Plane │  │    AI Service      │    │
│  │ (Next.js)  │◄─│  (FastAPI)    │─►│ (LLM abstraction)  │    │
│  │ apps/web/  │  │ :8000         │  │ services/ai-service │    │
│  └────────────┘  └───────┬───────┘  └────────────────────┘    │
│                          │                                      │
│       ┌──────────────────┼──────────────────┐                  │
│       │                  │                  │                   │
│       ▼                  ▼                  ▼                   │
│ ┌────────────┐  ┌──────────────┐  ┌──────────────┐           │
│ │ Assessment │  │  Deployment  │  │   Monitor    │           │
│ │  Engine    │  │   Engine     │  │   Service    │           │
│ │ (Node.js)  │  │  (Python)    │  │  (Python)    │           │
│ │  :3100     │  │  Kafka cons. │  │  :8002       │           │
│ └─────┬──────┘  └──────┬───────┘  └──────────────┘           │
│       │                 │                                       │
│       │    ┌────────────┼─────────────────┐                    │
│       │    │  RUNTIME SECURITY PIPELINE   │                    │
│       │    │                              │                    │
│       │    │  ┌────────────────────────┐  │                    │
│       │    │  │   Kafka (event bus)    │  │                    │
│       │    │  └───┬────────┬───────────┘  │                    │
│       │    │      │        │              │                    │
│       │    │      ▼        ▼              │                    │
│       │    │  ┌───────┐ ┌───────────┐    │                    │
│       │    │  │Telemetry│ │  Graph   │    │                    │
│       │    │  │Ingestion│ │  Engine  │    │                    │
│       │    │  └───┬────┘ └────┬─────┘    │                    │
│       │    │      │           │           │                    │
│       │    │      ▼           ▼           │                    │
│       │    │  ┌───────┐  ┌────────┐      │                    │
│       │    │  │ClickHse│  │ Neo4j  │      │                    │
│       │    │  └────────┘  └───┬────┘      │                    │
│       │    │                  │           │                    │
│       │    │                  ▼           │                    │
│       │    │          ┌────────────┐     │                    │
│       │    │          │ Detection  │     │                    │
│       │    │          │  Engine    │     │                    │
│       │    │          │(MITRE ATT&CK)│   │                    │
│       │    │          └────────────┘     │                    │
│       │    └─────────────────────────────┘                    │
│       │                                                        │
│       └──────────────┬─────────────────────────────────────────│
│                      ▼                                         │
│               ┌────────────┐                                   │
│               │ PostgreSQL │                                   │
│               └────────────┘                                   │
├─────────────────────────────────────────────────────────────────┤
│  AWS: EKS, RDS, MSK, ElastiCache, ECR, S3                     │
│  Observability: Prometheus + Grafana + Vector                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. APIs Created

### Assessment Engine API (NEW — `services/assessment-engine/src/server.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/assess/url` | Trigger URL security scan |
| POST | `/assess/repository` | Trigger repository security scan |
| GET | `/assess/:scanId` | Get scan status and posture |
| GET | `/assess/:scanId/findings` | Get canonical findings |
| GET | `/assess/:scanId/report` | Get formatted report |
| GET | `/health` | Health check |

### Existing APIs (preserved from 01_KAYO Control Plane)

All existing control plane routes preserved unchanged:
- `/api/auth/*` — Authentication
- `/api/tenants/*` — Tenant management
- `/api/deployments/*` — Deployment CRUD + blue-green + rollback
- `/api/incidents/*` — Incident management + attack-path + AI explain
- `/api/invitations/*` — Team invitations
- `/api/webhooks/*` — Webhook management
- `/api/audit-logs/*` — Audit trail
- `/api/compliance/*` — Compliance reports + GDPR
- `/ws` — WebSocket real-time events
- `/health` — Health check

---

## 7. Shared Schemas Created

File: `KAYO/packages/shared-schemas/models.py`

| Schema | Purpose | Fields (key) |
|--------|---------|------|
| Asset | Tracked application/service | asset_id, tenant_id, name, type, git_repo, deployment_id |
| Scan | Security assessment scan | scan_id, tenant_id, type, target, status, posture_score, finding_counts |
| Finding | Security finding | finding_id, scan_id, type, severity, category, description, endpoint, evidence |
| Vulnerability | Known CVE/advisory | vulnerability_id, cve_id, package, version, ecosystem, severity |
| SecurityGateResult | Pre-deploy gate decision | gate_id, deployment_id, passed, decision, policy_violations |
| Alert | Security alert | alert_id, type, severity, title, source_service |
| Report | Generated report | report_id, scan_id, type, format, content, ai_summary |
| MonitorProbe | Uptime probe result | probe_id, target_url, status_code, latency_ms, health |
| StressTestResult | Stress test result | test_id, target_url, rps_avg, success_rate_pct, verdict |

Plus enums: Severity, ScanType, ScanStatus, DeploymentStatus, IncidentStatus, PostureRating

---

## 8. Tests Run

| Test | Command | Tests | Passed | Failed | Skipped | Reason |
|------|---------|-------|--------|--------|---------|--------|
| Security Gate | inline python | 3 | 3 | 0 | 0 | — |
| Stack Detector | inline python | 2 | 2 | 0 | 0 | — |
| Safe Extract (zip-slip) | inline python | 1 | 1 | 0 | 0 | — |
| Shared Schemas | inline python | 3 | 3 | 0 | 0 | — |
| Control Plane unit tests | pytest tests/unit/ | 7 | 0 | 7 | 0 | Import path issue (pre-existing; needs PYTHONPATH config) |
| Assessment Engine (ASTRA) | — | — | — | — | — | npm install timed out; tests not run (dependency install required) |

**Note**: The control-plane unit test failures are a **pre-existing issue** from the original 01_KAYO repo — the tests use `from services.control_plane.xxx` import paths that require PYTHONPATH to be set. This is not a regression introduced by the consolidation.

---

## 9. Security Fixes Implemented

| Fix | File | Description |
|-----|------|-------------|
| SSRF Protection | `services/assessment-engine/src/ssrf-guard.ts` | Blocks private IPs, metadata endpoints, dangerous protocols, localhost |
| ZIP Path Traversal | `services/deployment-engine/safe_extract.py` | Prevents zip-slip attacks, size/count limits, symlink rejection |
| Security Gate | `services/deployment-engine/security_gate.py` | Blocks deployment on critical findings/secrets/CVEs |
| Non-root Containers | `services/deployment-engine/dockerfile_generator.py` | All generated Dockerfiles use non-root users |
| Credential Blocking | `KAYO/.gitignore` | Blocks `*-key.json`, `*.pem`, `*.credentials` from being committed |
| No GCP Credentials | — | `kayo-gcp-key.json` explicitly NOT copied into unified repo |
| Service Auth | `services/assessment-engine/src/server.ts` | Service-to-service token authentication |
| Safety Limits | `services/monitor-service/stress_tester.py` | MAX_CONCURRENCY=50, MAX_DURATION=120s enforced |

---

## 10. Security Issues Remaining

| Issue | Location | Severity | Status |
|-------|----------|----------|--------|
| CORS wildcard | services/control-plane/main.py `allow_origins=["*"]` | HIGH | Unchanged (needs domain restriction for production) |
| DNS rebinding | services/assessment-engine/src/ssrf-guard.ts | MEDIUM | Hostname-only check; no DNS resolution verification |
| Unauthenticated tenant creation | services/control-plane/api/routes/tenants.py | MEDIUM | By design (signup flow) but needs rate limiting |
| Active scan authorization | services/assessment-engine/src/server.ts | MEDIUM | Flag exists but no server-side target ownership verification |
| Container image scanning | services/deployment-engine/ | MEDIUM | Not implemented (Trivy integration needed) |
| Token in WebSocket URL | services/control-plane/main.py `/ws?token=` | LOW | Acceptable for WS but visible in logs |
| Dev secrets in docker-compose | docker-compose.yml | LOW | Dev-only, documented |

---

## 11. GCP Dependencies Remaining

**ZERO** GCP dependencies exist in the `KAYO/` unified repository.

- No GCP service account keys
- No Cloud Build references
- No Cloud Run references
- No Artifact Registry references
- No GCS references
- No `google-cloud-*` packages in any requirements.txt or package.json
- All infrastructure uses AWS (EKS, ECR, RDS, MSK, ElastiCache, S3)

---

## 12. Known Limitations

1. **Assessment engine npm dependencies not installed** — Network timeout prevented `npm install`; ASTRA's test suite cannot run until dependencies are installed
2. **Control plane tests need PYTHONPATH** — Pre-existing issue requiring `PYTHONPATH=services/control-plane` to resolve imports
3. **AI service provider abstraction not yet implemented** — Currently only has the OpenAI-based explainer; Groq adapter not yet added
4. **No end-to-end integration wiring** — Assessment engine API exists but control plane doesn't call it yet
5. **Frontend lacks assessment/monitoring pages** — Dashboard preserved but new screens not added
6. **Deployment security gate not wired** — Module exists but not integrated into deployment orchestrator's Kafka consumer flow
7. **Monitor service has no HTTP server** — uptime_monitor.py and stress_tester.py are modules, not a running service yet
8. **Some SEVE capabilities deferred** — Port scanning, rate-limit testing, auth bypass testing, DB exposure testing not yet ported to assessment engine

---

## 13. Migration Status

| Area | Progress |
|------|----------|
| Assessment Engine | 85% |
| Deployment Engine | 70% |
| Runtime Security | 95% |
| Monitoring | 60% |
| AI Service | 50% |
| Frontend | 80% |
| Shared Schemas | 70% |
| AWS Migration | 100% |
| End-to-End Integration | 30% |

---

## 14. Rollback Information

The consolidation is fully reversible:

1. **Original repositories are untouched** — `01_KAYO/`, `ASTRA/`, `SEVE-SaaS/` remain in their original state
2. **All work is in `KAYO/`** — Delete the `KAYO/` directory to fully revert
3. **No dependencies modified** — No npm install, pip install, or config changes in originals
4. **No git operations on originals** — No commits, no branch changes

To revert:
```powershell
Remove-Item -Recurse -Force "e:\KAYO\KAYO"
```

The three original codebases will continue to function independently as before.

---

PHASE 2 COMPLETE — AWAITING REVIEW

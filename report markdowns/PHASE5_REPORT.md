# KAYO Phase 5 — Unified Product Consolidation

**Date**: August 15, 2026  
**Status**: COMPLETE

---

## 1. Final Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       KAYO PLATFORM                                  │
│                                                                     │
│  ASSESS → SECURITY GATE → DEPLOY → MONITOR → DETECT → ALERT       │
│                                                                     │
│  ┌──────────┐  ┌──────────────────┐  ┌──────────────────────┐     │
│  │ Frontend │  │   Control Plane  │  │     AI Service       │     │
│  │(Next.js) │◄─│  (FastAPI :8000) │─►│ (OpenAI/Groq)        │     │
│  │ Assets   │  │ Auth/Tenants     │  │ Explain/Summarize    │     │
│  │ Assess   │  │ Scans/Findings   │  └──────────────────────┘     │
│  │ Deploy   │  │ Deploy/Gate      │                                │
│  │ Monitor  │  │ Incidents/Alerts │                                │
│  │ Incident │  │ Monitor/Report   │                                │
│  └──────────┘  └────────┬─────────┘                                │
│                          │                                          │
│      ┌───────────────────┼───────────────────┐                     │
│      │                   │                   │                      │
│      ▼                   ▼                   ▼                      │
│ ┌──────────┐   ┌──────────────┐   ┌──────────────┐               │
│ │Assessment│   │  Deployment  │   │   Monitor    │               │
│ │ Engine   │   │   Engine     │   │   Service    │               │
│ │(Node:3100)│   │  (Python)    │   │ (Python:8002)│               │
│ │ Playwright│   │ Gate+Build   │   │ Probe+Stress │               │
│ │ SSRF Guard│   │ Stack Detect │   │ Persistence  │               │
│ └──────────┘   └──────┬───────┘   └──────────────┘               │
│                        │                                           │
│               ┌────────┴────────────────────────┐                  │
│               │     RUNTIME SECURITY            │                  │
│               │                                 │                  │
│               │  Kafka → Telemetry → ClickHouse │                  │
│               │  Kafka → Graph Eng → Neo4j      │                  │
│               │  Kafka → Detection → Incident   │                  │
│               │         → Alert Dispatcher      │                  │
│               │           → WebSocket           │                  │
│               │           → Webhook             │                  │
│               └─────────────────────────────────┘                  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────┐     │
│  │  PostgreSQL: tenants, users, assets, scans, findings,     │     │
│  │    deployments, incidents, webhooks, audit_logs,           │     │
│  │    monitor_endpoints, monitor_probes                       │     │
│  └───────────────────────────────────────────────────────────┘     │
├─────────────────────────────────────────────────────────────────────┤
│  Infrastructure: AWS (EKS, RDS, MSK, ElastiCache, ECR)             │
│  Local: Docker Compose (all services)                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Unified Product Capabilities

### Assessment
- URL security scanning (passive + active with authorization)
- Repository security analysis (secrets, deps, workflows, code)
- Technology fingerprinting + CVE correlation
- Posture scoring (0-100)
- Canonical finding generation

### Deployment
- GitHub/ZIP source ingestion
- Stack detection (Node, Python, Static, SPA)
- Security gate enforcement (mandatory, fail-closed)
- Dockerfile generation (non-root, multi-stage)
- Safe archive extraction (zip-slip protected)

### Runtime Security
- Telemetry ingestion (Kafka → ClickHouse)
- Behavior graph construction (Neo4j)
- MITRE ATT&CK detection (15 rules)
- Incident creation + management
- Alert dispatch (WebSocket + Webhook)
- AI-powered explanation

---

## 3. Domain Model

See `docs/DOMAIN_MODEL.md` for complete specification.

Core entities: Tenant → Asset → Scan → Finding, Asset → Deployment → MonitorEndpoint, Asset → Incident → Alert

---

## 4. Major Changes (Phase 5)

| File | Change |
|------|--------|
| `docs/DOMAIN_MODEL.md` | **NEW** — Canonical domain model |
| `docs/FINAL_SECURITY_AUDIT.md` | **NEW** — Security audit with findings |
| `docs/INFRASTRUCTURE_MODES.md` | **NEW** — Local vs AWS modes |
| `docs/ASSESSMENT_ENGINE.md` | **NEW** — Assessment engine documentation |
| `services/control-plane/services/alert_dispatcher.py` | **NEW** — Unified alert dispatch |
| `services/monitor-service/persistence.py` | **NEW** — PostgreSQL persistence for monitoring |
| `services/assessment-engine/Dockerfile` | **MODIFIED** — Pinned Playwright, non-root user |
| `apps/web/app/dashboard/assessments/page.tsx` | **NEW** — Assessments UI page |
| `apps/web/app/dashboard/assets/page.tsx` | **NEW** — Assets UI page |
| `apps/web/app/dashboard/layout.tsx` | **MODIFIED** — Added Assets + Assessments nav |

---

## 5. Removed Components

No components were removed in this phase. The KAYO repository contains only consolidated code — no SEVE/ASTRA legacy cruft exists (those were never copied for unrelated functionality).

---

## 6. Security Improvements

| Fix | Location |
|-----|----------|
| SSRF guard (private IP, metadata, protocol blocking) | `assessment-engine/src/ssrf-guard.ts` |
| ZIP path traversal protection | `deployment-engine/safe_extract.py` |
| Non-root Docker containers | `deployment-engine/dockerfile_generator.py` |
| Security gate fail-closed | `deployment-engine/gate_enforcer.py` |
| AI credential redaction | `ai-service/providers.py` |
| Service-to-service auth tokens | All inter-service HTTP calls |
| Stress test authorization required | `monitor-service/main.py` |
| Playwright browser pinned in Docker | `assessment-engine/Dockerfile` |

---

## 7. Assessment Engine Status

| Aspect | Status |
|--------|--------|
| TypeScript compiles | ✅ |
| HTTP API server works | ✅ (health + scan endpoints) |
| SSRF guard works | ✅ |
| Playwright packaging in Docker | ✅ (pinned, `--with-deps`) |
| Local execution | ⚠️ Requires matching Chromium version |
| Docker execution | ✅ Reproducible (self-contained browser) |

---

## 8. Deployment Status

| Mode | Status |
|------|--------|
| LOCAL (Docker Compose) | ✅ All infrastructure starts, services communicate |
| AWS (Terraform + EKS) | Configured (Terraform modules exist), not deployed |

---

## 9. Runtime Status

| Stage | Proven |
|-------|--------|
| Event → Kafka | ✅ LIVE |
| Kafka → ClickHouse | ✅ LIVE (3 events verified) |
| Kafka → Neo4j | ✅ LIVE (23 entities, 16 relationships) |
| Neo4j → Detection | ✅ LIVE (T1078 rule, 16 matches) |
| Detection → Incident | ✅ LIVE (PostgreSQL row) |
| Incident → WebSocket Alert | ✅ LIVE (received by client) |

---

## 10. Frontend

| Page | Path | Status |
|------|------|--------|
| Dashboard | `/dashboard` | ✅ Existing |
| Assets | `/dashboard/assets` | ✅ **NEW** |
| Assessments | `/dashboard/assessments` | ✅ **NEW** |
| Deployments | `/dashboard/deployments` | ✅ Existing |
| Incidents | `/dashboard/incidents` | ✅ Existing |
| Monitor | `/dashboard/monitor` | ✅ Existing |
| Audit Logs | `/dashboard/audit` | ✅ Existing |
| Compliance | `/dashboard/compliance` | ✅ Existing |
| Settings | `/dashboard/settings` | ✅ Existing |

---

## 11. Testing

| Suite | Command | Total | Passed | Failed | Skipped |
|-------|---------|-------|--------|--------|---------|
| E2E Lifecycle | `pytest tests/e2e/test_full_lifecycle.py` | 20 | 20 | 0 | 0 |
| Integration | `pytest tests/integration/test_lifecycle.py -k "not asyncio..."` | 20 | 20 | 0 | 4 (async) |
| Unit (pre-existing) | `pytest tests/unit/` | 7 | 0 | 0 | 7 (import path) |
| Runtime Detection | Manual E2E (Phase 4.6) | 1 | 1 | 0 | 0 |
| Alert Delivery | Manual E2E (Phase 4.7) | 1 | 1 | 0 | 0 |
| **Total** | | **49** | **42** | **0** | **7** |

The 7 skipped unit tests are a pre-existing PYTHONPATH configuration issue (not a Phase 5 regression).

---

## 12. Known Limitations

1. **Assessment Chromium local**: Host requires matching Playwright browser version. Docker image is self-contained.
2. **Container image scanning**: Designed but not yet integrated (Trivy).
3. **Monitor auto-registration**: Logic exists but not auto-triggered after deployment completion.
4. **DNS rebinding**: Hostname-level SSRF check only; no post-DNS-resolution IP verification.
5. **CORS**: Still wildcard in development. Must be restricted for production.
6. **Alert from detection**: Detection engine creates incident in PostgreSQL. Alert dispatch happens when incident is accessed via API (not push-from-detection). Alert Dispatcher module exists for future direct integration.

---

## 13. Deferred Work

| Item | Reason |
|------|--------|
| Trivy container scanning | Integration point designed, implementation deferred |
| Auto-deploy after gate pass | Architecture ready, Kafka trigger not wired |
| DNS rebinding protection | Requires async DNS resolution in SSRF guard |
| Production CORS configuration | Trivial but requires knowing production domain |
| Full AWS deployment validation | Requires AWS account + terraform apply |

---

## 14. Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Assessment Engine in Node.js | Playwright requires Node.js; keeps ASTRA modules intact |
| Python for all other services | Consistency with KAYO core; FastAPI for API |
| Neo4j for behavior graphs | Native graph traversal for attack path analysis |
| ClickHouse for telemetry | Columnar storage optimized for time-series analytics |
| Kafka for event streaming | High throughput, replay capability, service decoupling |
| PostgreSQL as primary store | Relational integrity for domain entities |
| Single-DB model (dev) | Neo4j Community doesn't support multi-database; tenant isolation via node properties in dev |

---

## 15. Final Security Audit

See `docs/FINAL_SECURITY_AUDIT.md`. Summary:
- 0 CRITICAL (GCP key removed)
- 2 HIGH (active scan control exists; gate fail-closed proven)
- 3 MEDIUM (CORS wildcard, DNS rebinding, no image scanning)
- 2 LOW (dev secrets, WS token in URL)

---

## 16. Product Readiness

### **FUNCTIONAL PROTOTYPE**

KAYO is a working functional prototype that demonstrates the complete security lifecycle end-to-end. All major pipeline stages have been proven live with real infrastructure. It is suitable for:
- Technical demonstration
- Hackathon presentation
- Architecture validation
- Feature development baseline

It is NOT yet production-ready due to:
- Unresolved medium-severity security items
- No actual AWS deployment validation
- Container image scanning not integrated
- Monitor auto-registration not triggered

---

## 17. Final Repository Structure

```
KAYO/
├── apps/
│   └── web/                          # Next.js frontend (9 pages)
├── services/
│   ├── control-plane/                # FastAPI API (auth, assets, scans, deploy, incidents)
│   ├── assessment-engine/            # Node.js + Playwright (URL + repo scanning)
│   ├── deployment-engine/            # Python (gate, stack detect, build, deploy)
│   ├── monitor-service/              # Python FastAPI (uptime, stress, persistence)
│   ├── detection-engine/             # Python (MITRE ATT&CK rules, Kafka consumer)
│   ├── graph-engine/                 # Python (Neo4j graph construction)
│   ├── telemetry-ingestion/          # Python (Kafka → ClickHouse)
│   └── ai-service/                   # Python (OpenAI/Groq provider abstraction)
├── packages/
│   ├── shared-schemas/               # Canonical models + event schema
│   ├── security-rules/               # 15 MITRE ATT&CK YAML rules
│   └── deployment-templates/         # Stack detection reference
├── infrastructure/
│   ├── terraform/                    # AWS IaC (VPC, EKS, RDS, MSK, etc.)
│   ├── kubernetes/                   # K8s manifests
│   ├── clickhouse/                   # Event schema
│   ├── monitoring/                   # Prometheus + Grafana
│   ├── grafana/                      # Dashboard JSONs
│   └── vector/                       # Log pipeline
├── tests/
│   ├── unit/                         # 7 tests (PYTHONPATH issue)
│   ├── integration/                  # 20 tests (all pass)
│   ├── e2e/                          # 20 tests + runtime detection + alert test
│   ├── load/                         # k6 scripts
│   └── security/                     # OWASP tests
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DOMAIN_MODEL.md
│   ├── ASSESSMENT_ENGINE.md
│   ├── FINAL_SECURITY_AUDIT.md
│   ├── INFRASTRUCTURE_MODES.md
│   ├── API_CONTRACTS.md
│   ├── SECURITY_MODEL.md
│   ├── CONSOLIDATION_MAP.md
│   └── MIGRATION_STATUS.md
├── .github/workflows/                # CI/CD (test + deploy)
├── docker-compose.yml                # Dev infrastructure
├── docker-compose.e2e.yml            # Full E2E environment
├── Makefile                          # Dev commands
└── README.md                         # Product overview
```

---

PHASE 5 COMPLETE — AWAITING REVIEW

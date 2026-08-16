# KAYO Consolidation Map

## Source Repositories (READ-ONLY references)

| Repository | Location | Role |
|-----------|----------|------|
| 01_KAYO | `../01_KAYO/` | Primary runtime security platform |
| ASTRA | `../ASTRA/` | Security assessment tool |
| SEVE-SaaS | `../SEVE-SaaS/` | Developer deployment + monitoring |

## Extraction History

### Control Plane
- **Source**: `01_KAYO/services/control-plane/`
- **Destination**: `KAYO/services/control-plane/`
- **Method**: Direct copy (full preservation)
- **Changes**: None — used as-is

### Detection Engine
- **Source**: `01_KAYO/services/detection-engine/`
- **Destination**: `KAYO/services/detection-engine/`
- **Method**: Direct copy
- **Changes**: None

### Graph Engine
- **Source**: `01_KAYO/services/graph-engine/`
- **Destination**: `KAYO/services/graph-engine/`
- **Method**: Direct copy
- **Changes**: None

### Telemetry Ingestion
- **Source**: `01_KAYO/services/telemetry-ingestion/`
- **Destination**: `KAYO/services/telemetry-ingestion/`
- **Method**: Direct copy
- **Changes**: None

### AI Service
- **Source**: `01_KAYO/services/ai-explainer/`
- **Destination**: `KAYO/services/ai-service/`
- **Method**: Direct copy (to be extended with provider abstraction)
- **Changes**: Renamed directory from ai-explainer to ai-service

### Assessment Engine
- **Source**: `ASTRA/src/` (all modules)
- **Destination**: `KAYO/services/assessment-engine/src/`
- **Method**: Extracted analysis core + added HTTP API server
- **Changes**:
  - Added `server.ts` — HTTP API wrapping ASTRA's analysis functions
  - Added `ssrf-guard.ts` — SSRF protection for URL inputs
  - Preserved all security modules, repo modules, AI client, tests
  - Preserved package.json, tsconfig, vitest configs

### Deployment Engine
- **Source**: `01_KAYO/services/deployment-orchestrator/` + `SEVE-SaaS/kayo_deploy.py`
- **Destination**: `KAYO/services/deployment-engine/`
- **Method**: Combined — KAYO orchestrator + SEVE utilities reimplemented
- **Changes**:
  - Copied KAYO deployment_orchestrator.py, build_service.py, manifest_generator.py
  - Created `stack_detector.py` — extracted from SEVE's detect_stack()
  - Created `dockerfile_generator.py` — extracted from SEVE's DOCKERFILES
  - Created `security_gate.py` — new pre-deployment security validation
  - Created `safe_extract.py` — safe ZIP extraction (replaces SEVE's unsafe version)
  - **NO GCP code copied** — all GCP-specific logic excluded

### Monitor Service
- **Source**: `SEVE-SaaS/kayo_monitor.py` + `SEVE-SaaS/kayo_stress.py`
- **Destination**: `KAYO/services/monitor-service/`
- **Method**: Reimplemented as importable modules
- **Changes**:
  - `uptime_monitor.py` — restructured from CLI script to module with typed output
  - `stress_tester.py` — restructured with safety limits and authorization requirements
  - Removed print-based output, replaced with structured return values
  - Added safety caps (MAX_CONCURRENCY=50, MAX_DURATION=120s)

### Frontend
- **Source**: `01_KAYO/frontend/`
- **Destination**: `KAYO/apps/web/`
- **Method**: Direct copy
- **Changes**: None (to be extended with assessment/monitoring pages)

### Infrastructure
- **Source**: `01_KAYO/infrastructure/`
- **Destination**: `KAYO/infrastructure/`
- **Method**: Direct copy
- **Changes**: None

### Shared Schemas
- **Source**: `01_KAYO/shared/schemas/` + new canonical models
- **Destination**: `KAYO/packages/shared-schemas/`
- **Method**: Copied event_schema.json + created new canonical models.py
- **Changes**: Added Asset, Scan, Finding, Vulnerability, SecurityGateResult, Alert, Report, MonitorProbe, StressTestResult models

### Security Rules
- **Source**: `01_KAYO/services/detection-engine/rules/`
- **Destination**: `KAYO/packages/security-rules/`
- **Method**: Direct copy
- **Changes**: None

## Components NOT Migrated

| Component | Source | Reason |
|-----------|--------|--------|
| SEVE Drive Scanner | SEVE-SaaS/drive_scanner.py | Unrelated to web security |
| SEVE Wipe Utils | SEVE-SaaS/wipe_utils.py | Unrelated (data erasure) |
| SEVE Browser Analyzer | SEVE-SaaS/browser_analyzer.py | Unrelated (forensics) |
| SEVE Forensic Scanner | SEVE-SaaS/forensic_scanner.py | Unrelated |
| SEVE Malware Detector | SEVE-SaaS/malware_detector.py | Unrelated |
| SEVE Network Monitor | SEVE-SaaS/network_monitor.py | Unrelated (local net) |
| SEVE Exfiltration Detector | SEVE-SaaS/exfiltration_detector.py | Unrelated |
| SEVE Embedded Python | SEVE-SaaS/python/ | Desktop-specific |
| SEVE GGUF Model | SEVE-SaaS/models/ | Desktop-specific |
| SEVE GCP Key | SEVE-SaaS/kayo-gcp-key.json | CREDENTIAL — never copy |
| SEVE GCP Manager | SEVE-SaaS/kayo_gcp_manager.py | GCP-specific |
| SEVE GCP Deploy | SEVE-SaaS/kayo_deploy.py (GCP parts) | GCP-specific |
| SEVE Desktop UI | SEVE-SaaS/src1/ | Desktop-specific |
| ASTRA Electron App | ASTRA/electron/ | Desktop-specific |
| SEVE WhatsApp Alerter | SEVE-SaaS/kayo_alerter/ | Deferred (niche) |
| SEVE kayo_scanner.py | SEVE-SaaS/kayo_scanner.py | Superseded by assessment-engine |

## GCP Dependencies Status

The unified KAYO repository has **ZERO** GCP dependencies.
All deployment infrastructure uses AWS (EKS, ECR, RDS, MSK).

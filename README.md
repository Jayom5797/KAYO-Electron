# KAYO — Security Lifecycle Platform

**ASSESS → SECURE → DEPLOY → MONITOR → DETECT → RESPOND → REASSESS**

KAYO is a unified security lifecycle platform that assesses applications, securely deploys them, continuously monitors deployed applications, detects threats, and provides security intelligence throughout their lifecycle.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         KAYO Platform                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐   ┌─────────────────┐   ┌──────────────────┐    │
│  │   Frontend   │   │  Control Plane   │   │   AI Service     │    │
│  │  (Next.js)   │◄──│  (FastAPI API)   │──►│  (LLM Provider)  │    │
│  └──────────────┘   └────────┬─────────┘   └──────────────────┘    │
│                              │                                       │
│         ┌────────────────────┼────────────────────┐                 │
│         │                    │                    │                  │
│         ▼                    ▼                    ▼                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐       │
│  │  Assessment  │   │  Deployment  │   │  Monitor Service │       │
│  │   Engine     │   │   Engine     │   │  (Uptime+Stress) │       │
│  │  (Node.js)   │   │  (Python)    │   │  (Python)        │       │
│  └──────────────┘   └──────────────┘   └──────────────────┘       │
│         │                    │                    │                  │
│         │                    ▼                    │                  │
│         │            ┌──────────────┐             │                  │
│         │            │  Kubernetes  │             │                  │
│         │            │   Cluster    │             │                  │
│         │            └──────┬───────┘             │                  │
│         │                   │                     │                  │
│         │    ┌──────────────────────────┐         │                  │
│         │    │    Telemetry Pipeline    │         │                  │
│         │    │  Kafka → ClickHouse     │         │                  │
│         │    │  Kafka → Graph Engine   │         │                  │
│         │    │  Graph → Detection Eng  │         │                  │
│         │    └──────────────────────────┘         │                  │
│         │                                         │                  │
│         └────────────────┬────────────────────────┘                  │
│                          ▼                                           │
│                   ┌────────────┐                                     │
│                   │ PostgreSQL │                                     │
│                   └────────────┘                                     │
├─────────────────────────────────────────────────────────────────────┤
│  Infrastructure: AWS (EKS, RDS, MSK, ElastiCache, ECR, S3)         │
│  Observability: Prometheus + Grafana + Vector + OpenTelemetry       │
└─────────────────────────────────────────────────────────────────────┘
```

## Capabilities

### Assessment Engine
- URL security scanning (TLS, headers, CORS, CSP, cookies, CVEs, DNS)
- Repository security scanning (secrets, deps, workflows, code patterns)
- Active vulnerability testing (SQLi, XSS, IDOR — requires authorization)
- Technology fingerprinting and CMS analysis

### Deployment Engine
- GitHub/ZIP source ingestion
- Stack detection and Dockerfile generation
- Security gate (scan before deploy)
- Kubernetes-native container deployment
- Health checks and deployment verification

### Runtime Security
- Telemetry collection (Kafka event pipeline)
- Behavior graph construction (Neo4j)
- MITRE ATT&CK rule-based detection
- Anomaly detection
- Incident management with AI-powered explanations

### Monitoring
- Uptime monitoring with baseline comparison
- Resilience/stress testing
- Degradation detection and alerting

## Quick Start

```bash
# Start infrastructure
docker-compose up -d

# Run control plane
cd services/control-plane && uvicorn main:app --reload

# Run assessment engine
cd services/assessment-engine && npm start

# Run frontend
cd apps/web && npm run dev
```

## Technology Stack

- **API**: FastAPI (Python 3.12)
- **Assessment**: Node.js + TypeScript + Playwright
- **Frontend**: Next.js 14 + React + Tailwind CSS
- **Databases**: PostgreSQL, Neo4j, ClickHouse, Redis
- **Messaging**: Apache Kafka
- **Infrastructure**: AWS (EKS, ECR, RDS, MSK), Terraform, Kubernetes
- **Observability**: Prometheus, Grafana, Vector, OpenTelemetry

## Project Structure

```
KAYO/
├── apps/web/                    # Next.js frontend
├── services/
│   ├── control-plane/           # FastAPI API gateway
│   ├── assessment-engine/       # URL + repo security scanning
│   ├── deployment-engine/       # Build + deploy pipeline
│   ├── monitor-service/         # Uptime + resilience testing
│   ├── detection-engine/        # Runtime threat detection
│   ├── graph-engine/            # Behavior graph construction
│   ├── telemetry-ingestion/     # Event pipeline
│   └── ai-service/              # Unified AI provider
├── packages/
│   ├── shared-schemas/          # Canonical data models
│   ├── security-rules/          # Detection rules (YAML)
│   └── deployment-templates/    # Stack templates + Dockerfiles
├── infrastructure/              # Terraform, K8s, ClickHouse
├── tests/                       # Unit, integration, e2e, load, security
├── docs/                        # Architecture, API, operations
└── scripts/                     # Development and CI scripts
```

## Consolidation

This platform was consolidated from three independent codebases:
- **01_KAYO**: Runtime security platform (primary foundation)
- **ASTRA**: Security assessment tool (assessment engine source)
- **SEVE-SaaS**: Developer deployment tool (deployment/monitoring utilities)

See `docs/CONSOLIDATION_MAP.md` for detailed extraction history.

## License

Copyright © 2026 KAYO Security. All rights reserved.

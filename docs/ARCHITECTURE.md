# KAYO Architecture

## Overview

KAYO is a security lifecycle platform built as cloud-native microservices.

## Services

| Service | Language | Purpose | Port |
|---------|----------|---------|------|
| Control Plane | Python/FastAPI | API gateway, auth, multi-tenant management | 8000 |
| Assessment Engine | TypeScript/Node.js | URL + repo security scanning | 3100 |
| Deployment Engine | Python | Build + deploy pipeline with security gate | 8001 |
| Monitor Service | Python | Uptime monitoring + resilience testing | 8002 |
| Detection Engine | Python | Runtime threat detection (MITRE ATT&CK) | — (Kafka consumer) |
| Graph Engine | Python | Behavior graph construction (Neo4j) | — (Kafka consumer) |
| Telemetry Ingestion | Python | Event pipeline (Kafka → ClickHouse) | — (Kafka consumer) |
| AI Service | Python | Unified AI provider abstraction | 8003 |

## Data Flow

```
                    ┌─────────────────┐
                    │   Frontend      │
                    │   (Next.js)     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Control Plane  │
                    │  (FastAPI)      │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
 │  Assessment  │   │  Deployment  │   │   Monitor    │
 │   Engine     │   │   Engine     │   │   Service    │
 └──────┬───────┘   └──────┬───────┘   └──────────────┘
        │                   │
        │                   ▼
        │           ┌──────────────┐
        │           │  Kubernetes  │
        │           └──────┬───────┘
        │                  │
        │           ┌──────▼───────┐
        │           │    Kafka     │
        │           └──────┬───────┘
        │                  │
        │      ┌───────────┼───────────┐
        │      │           │           │
        │      ▼           ▼           ▼
        │  ┌────────┐ ┌────────┐ ┌──────────┐
        │  │Telemetry│ │ Graph  │ │Detection │
        │  │Ingestion│ │ Engine │ │  Engine  │
        │  └────┬───┘ └────┬───┘ └──────────┘
        │       │          │
        │       ▼          ▼
        │  ┌────────┐ ┌────────┐
        │  │ClickHse│ │  Neo4j │
        │  └────────┘ └────────┘
        │
        └──────────────────┐
                           ▼
                    ┌────────────┐
                    │ PostgreSQL │
                    └────────────┘
```

## Security Lifecycle

```
ASSESS → SECURITY GATE → DEPLOY → MONITOR → DETECT → ALERT → REASSESS
```

1. **ASSESS**: Assessment engine scans URL/repo for vulnerabilities
2. **SECURITY GATE**: Deployment engine evaluates findings against policy
3. **DEPLOY**: If gate passes, build and deploy to Kubernetes
4. **MONITOR**: Monitor service tracks uptime and performance
5. **DETECT**: Detection engine identifies threats via behavior graphs
6. **ALERT**: Incidents created, alerts delivered (webhook, WebSocket)
7. **REASSESS**: Periodic re-assessment triggered

## Infrastructure

- **Cloud**: AWS (EKS, RDS, MSK, ElastiCache, ECR)
- **IaC**: Terraform
- **Container Orchestration**: Kubernetes (EKS)
- **CI/CD**: GitHub Actions

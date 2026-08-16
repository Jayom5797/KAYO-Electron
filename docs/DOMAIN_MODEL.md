# KAYO Domain Model

## Canonical Entity Relationships

```
Tenant
├── Users
├── Assets
│   ├── type: web_application | api | repository | service
│   ├── git_repo, url
│   ├── Scans[]
│   │   ├── type: url | repository | container | active
│   │   ├── status: pending | running | completed | failed
│   │   ├── posture_rating, posture_score
│   │   └── Findings[]
│   │       ├── type: tls | csp | cors | secret | dependency | vuln | ...
│   │       ├── severity: critical | high | medium | low | info
│   │       ├── category, description, endpoint, evidence
│   │       └── cve_id, mitre_technique
│   ├── Deployments[]
│   │   ├── status: pending | building | scanning | deploying | running | blocked
│   │   ├── git_repo, git_branch, image_name, endpoint
│   │   ├── security_gate_result
│   │   └── MonitorEndpoints[]
│   │       ├── url, baseline, health
│   │       └── ProbeHistory[]
│   ├── Runtime Events → ClickHouse (time-series)
│   └── Incidents[]
│       ├── severity, status, attack_pattern, mitre_technique
│       ├── event_chain, graph_snapshot
│       ├── ai_summary, remediation_steps
│       └── Alerts[]
│           ├── type: websocket | webhook
│           ├── delivered, delivery_status
│           └── payload
├── Webhooks[]
├── Policies[]
└── AuditLogs[]
```

## Core Entities (PostgreSQL)

### Tenant
Owner of all data. Isolation boundary.
- tenant_id, name, slug, tier, settings

### User  
Human identity within a tenant.
- user_id, tenant_id, email, password_hash, role

### Asset
Any tracked application/service/repository.
- asset_id, tenant_id, name, type, git_repo, url, tags

### Scan
A security assessment run.
- scan_id, tenant_id, asset_id, type, target, status
- posture_rating, posture_score, finding_counts

### Finding
Individual security issue from a scan.
- finding_id, scan_id, tenant_id, asset_id
- type, severity, category, description, endpoint, evidence, remediation

### Deployment
A deployed instance of an asset.
- deployment_id, tenant_id, app_name, git_repo, git_branch
- status, image_name, endpoint, k8s_namespace
- security_gate: {passed, decision, reason}

### Incident
A detected runtime security event.
- incident_id, tenant_id, severity, status
- attack_pattern, mitre_technique
- event_chain, graph_snapshot, ai_summary

### Alert (via Event Broadcaster + WebSocket/Webhook)
Notification of a security event.
- Delivered via: WebSocket (real-time) or Webhook (HTTP POST)
- Payload: incident_id, severity, type, timestamp

## Analytics Entities (ClickHouse)

### Event
Raw telemetry from deployed applications.
- event_id, tenant_id, timestamp, source_type
- event.category, event.type, event.action, event.outcome
- user, process, host, container, network, file
- risk_score, tags

## Graph Entities (Neo4j)

### Nodes
- User, Process, Host, Container, IPAddress, File

### Relationships
- AUTHENTICATED_TO, SPAWNED_BY, RUNS_ON, CONNECTED_TO, ACCESSED, EXECUTED_BY

## Key Invariants

1. **Tenant isolation**: Every query filters by tenant_id
2. **Asset identity**: Scans, deployments, and incidents reference the same asset
3. **Lifecycle tracing**: Asset → Scan → Gate → Deploy → Monitor → Detect → Incident
4. **No orphaned data**: Findings belong to Scans, Scans belong to Tenants
5. **Immutable scan history**: Reassessment creates new Scan, never overwrites

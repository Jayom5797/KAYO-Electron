# KAYO API Contracts

## Service-to-Service Communication

### Control Plane → Assessment Engine

```
POST http://assessment-engine:3100/assess/url
Headers: x-kayo-service-token: <token>
Body: {
  "url": "https://target.com",
  "tenant_id": "uuid",
  "active_scan": false,
  "timeout_ms": 30000
}
Response (202): { "scan_id": "uuid", "status": "running" }
```

```
POST http://assessment-engine:3100/assess/repository
Headers: x-kayo-service-token: <token>
Body: {
  "url": "https://github.com/owner/repo",
  "tenant_id": "uuid",
  "advanced": false,
  "token": "optional-github-token"
}
Response (202): { "scan_id": "uuid", "status": "running" }
```

```
GET http://assessment-engine:3100/assess/{scan_id}
Response: { "scan_id", "status", "posture", ... }
```

```
GET http://assessment-engine:3100/assess/{scan_id}/findings
Response: { "scan_id", "findings": [...] }
```

```
GET http://assessment-engine:3100/assess/{scan_id}/report?format=markdown
Response: { "scan_id", "format", "content": "..." }
```

### Control Plane → Deployment Engine (via Kafka)

```
Topic: deployment.requests
Message: {
  "deployment_id": "uuid",
  "tenant_id": "uuid",
  "app_name": "string",
  "git_repo": "string",
  "git_branch": "main",
  "scan_required": true
}
```

### Deployment Engine → Assessment Engine (Security Gate)

```
POST http://assessment-engine:3100/assess/repository
→ GET /assess/{scan_id}/findings
→ Security Gate evaluation
→ Deploy or Block
```

### Control Plane → Monitor Service

```
POST http://monitor-service:8002/monitor/start
Body: {
  "tenant_id": "uuid",
  "deployment_id": "uuid",
  "url": "https://deployed-app.kayo.app",
  "interval_s": 30
}
```

```
POST http://monitor-service:8002/stress/run
Body: {
  "tenant_id": "uuid",
  "url": "https://deployed-app.kayo.app",
  "concurrency": 20,
  "duration_s": 30,
  "authorized": true
}
```

## Client-Facing API (Control Plane)

All client requests go through the Control Plane at port 8000.

### Authentication
- `POST /api/auth/signup` — Self-service signup
- `POST /api/auth/login` — Login (returns JWT)
- `GET  /api/auth/me` — Current user info

### Assessments
- `POST /api/assessments/url` — Trigger URL scan
- `POST /api/assessments/repository` — Trigger repo scan
- `GET  /api/assessments` — List scans
- `GET  /api/assessments/{id}` — Scan details
- `GET  /api/assessments/{id}/findings` — Scan findings
- `GET  /api/assessments/{id}/report` — Formatted report

### Deployments
- `POST /api/deployments` — Create deployment
- `GET  /api/deployments` — List deployments
- `GET  /api/deployments/{id}` — Deployment details
- `POST /api/deployments/{id}/rollback` — Rollback

### Incidents
- `GET  /api/incidents` — List incidents
- `GET  /api/incidents/{id}` — Incident details
- `GET  /api/incidents/{id}/attack-path` — Attack graph
- `POST /api/incidents/{id}/explain` — AI explanation

### Monitoring
- `GET  /api/monitoring/status` — Current health
- `GET  /api/monitoring/probes` — Probe history

## Kafka Topics

| Topic | Producer | Consumer | Schema |
|-------|----------|----------|--------|
| `telemetry.*` | Deployed apps (via Vector) | telemetry-ingestion, graph-engine | event_schema.json |
| `graph.updates` | graph-engine | detection-engine | GraphUpdateEvent |
| `deployment.requests` | control-plane | deployment-engine | DeploymentRequest |
| `incidents` | detection-engine | control-plane (webhook delivery) | IncidentEvent |

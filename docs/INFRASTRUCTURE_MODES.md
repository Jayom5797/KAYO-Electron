# KAYO Infrastructure Modes

## LOCAL / DEMO Mode

For development and demonstration. All services run locally via Docker Compose.

```bash
docker compose -f docker-compose.e2e.yml up -d
```

| Component | Implementation | Purpose | Required |
|-----------|---------------|---------|----------|
| PostgreSQL | Docker (postgres:16) | Primary datastore | Yes |
| Redis | Docker (redis:7.2) | Rate limiting, caching | Yes |
| Kafka | Docker (confluent 7.5) | Event streaming | Yes (for runtime) |
| ClickHouse | Docker (23.8) | Telemetry analytics | Yes (for runtime) |
| Neo4j | Docker (5.15 Community) | Behavior graphs | Yes (for runtime) |
| Control Plane | Host/Docker (Python) | API gateway | Yes |
| Assessment Engine | Host/Docker (Node.js) | Security scanning | Yes |
| Monitor Service | Host/Docker (Python) | Uptime monitoring | Yes |

**Note**: Runtime services (telemetry, graph, detection) are optional for assessment-only workflows.

## PRODUCTION / AWS Mode

Full production deployment using managed AWS services.

| Component | AWS Service | Notes |
|-----------|-------------|-------|
| PostgreSQL | RDS | Multi-AZ, encrypted |
| Redis | ElastiCache | Cluster mode |
| Kafka | MSK | 3-broker, encrypted |
| ClickHouse | EC2 (self-managed) | Columnar analytics |
| Neo4j | EC2 (self-managed) | Graph database |
| Application Services | EKS | Kubernetes pods |
| Container Registry | ECR | Image storage |
| Load Balancer | ALB | TLS termination |
| DNS | Route 53 | Domain management |
| State | S3 | Terraform state |

**IaC**: `infrastructure/terraform/`
**K8s Manifests**: `infrastructure/kubernetes/base/`

## Resource Requirements

### Local/Demo (minimum)
- RAM: 8 GB (all containers)
- CPU: 4 cores
- Disk: 10 GB (images + data)

### Production (per component)
Defined in Kubernetes resource limits:
- Control Plane: 512Mi-1Gi RAM, 250m-1000m CPU
- Detection Engine: 1-2Gi RAM, 500m-2000m CPU
- Other services: see `infrastructure/kubernetes/base/*.yaml`

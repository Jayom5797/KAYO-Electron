"""
KAYO Canonical Data Models

These are the shared domain models used across all KAYO services.
Every service should reference these canonical concepts rather than
defining its own incompatible versions.

Extracted from:
- 01_KAYO/services/control-plane/models/ (Tenant, User, Deployment, Incident)
- 01_KAYO/shared/schemas/event_schema.json (Event)
- New canonical types (Asset, Scan, Finding, Vulnerability, Report)
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
import uuid


# ── Enums ──────────────────────────────────────────────────────────────────────

class Severity(str, Enum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"
    info = "info"


class ScanType(str, Enum):
    url = "url"
    repository = "repository"
    active = "active"
    container = "container"


class ScanStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class DeploymentStatus(str, Enum):
    pending = "pending"
    building = "building"
    build_failed = "build_failed"
    scanning = "scanning"
    scan_failed = "scan_failed"
    blocked = "blocked"
    deploying = "deploying"
    deploy_failed = "deploy_failed"
    running = "running"
    stopped = "stopped"
    rolling_back = "rolling_back"


class IncidentStatus(str, Enum):
    new = "new"
    investigating = "investigating"
    confirmed = "confirmed"
    resolved = "resolved"
    false_positive = "false_positive"


class PostureRating(str, Enum):
    critical = "Critical"
    high = "High"
    medium = "Medium"
    low = "Low"
    good = "Good"


# ── Canonical Models ───────────────────────────────────────────────────────────

class Asset(BaseModel):
    """Represents a tracked application/service in KAYO"""
    asset_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    tenant_id: uuid.UUID
    name: str
    type: str = "web_application"  # web_application, api, repository, service
    description: Optional[str] = None
    git_repo: Optional[str] = None
    git_branch: Optional[str] = None
    url: Optional[str] = None
    deployment_id: Optional[uuid.UUID] = None
    tags: List[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Scan(BaseModel):
    """Represents a security assessment scan"""
    scan_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    tenant_id: uuid.UUID
    asset_id: Optional[uuid.UUID] = None
    type: ScanType
    target: str  # URL or repository URL
    status: ScanStatus = ScanStatus.pending
    posture_rating: Optional[PostureRating] = None
    posture_score: Optional[int] = None  # 0-100
    finding_counts: Dict[str, int] = Field(default_factory=lambda: {
        "critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0
    })
    total_findings: int = 0
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    duration_ms: Optional[int] = None
    error: Optional[str] = None
    metadata: Dict[str, Any] = {}
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Finding(BaseModel):
    """Represents a security finding from an assessment"""
    finding_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    scan_id: uuid.UUID
    tenant_id: uuid.UUID
    asset_id: Optional[uuid.UUID] = None
    type: str  # tls, csp, cors, secret, dependency, vuln, etc.
    severity: Severity
    category: str  # TLS, Headers, CORS, Cookies, Secrets, Dependencies, etc.
    title: Optional[str] = None
    description: str
    endpoint: Optional[str] = None
    evidence: Optional[str] = None
    remediation: Optional[str] = None
    cve_id: Optional[str] = None
    mitre_technique: Optional[str] = None
    status: str = "open"  # open, acknowledged, resolved, false_positive
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Vulnerability(BaseModel):
    """Represents a known vulnerability (CVE/advisory) affecting an asset"""
    vulnerability_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    tenant_id: uuid.UUID
    asset_id: Optional[uuid.UUID] = None
    scan_id: Optional[uuid.UUID] = None
    cve_id: str  # e.g., CVE-2024-1234 or GHSA-xxxx
    package: str
    version: str
    ecosystem: str  # npm, PyPI, Go, RubyGems
    severity: Severity
    summary: str
    fixed_version: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class SecurityGateResult(BaseModel):
    """Result of a pre-deployment security gate evaluation"""
    gate_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    deployment_id: uuid.UUID
    tenant_id: uuid.UUID
    scan_ids: List[uuid.UUID] = []
    passed: bool
    decision: str  # "deploy", "block", "warn"
    reason: str
    policy_violations: List[str] = []
    critical_findings: int = 0
    high_findings: int = 0
    evaluated_at: datetime = Field(default_factory=datetime.utcnow)


class Alert(BaseModel):
    """Represents a security alert (from monitoring or detection)"""
    alert_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    tenant_id: uuid.UUID
    type: str  # incident, degradation, downtime, finding
    severity: Severity
    title: str
    description: str
    source_service: str  # detection-engine, monitor-service, assessment-engine
    source_id: Optional[uuid.UUID] = None  # incident_id, scan_id, etc.
    acknowledged: bool = False
    resolved: bool = False
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Report(BaseModel):
    """Represents a generated security report"""
    report_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    tenant_id: uuid.UUID
    scan_id: Optional[uuid.UUID] = None
    incident_id: Optional[uuid.UUID] = None
    type: str  # assessment, incident, compliance, executive
    format: str  # markdown, json, pdf
    title: str
    content: str  # Report body (Markdown/JSON string)
    ai_summary: Optional[str] = None
    generated_at: datetime = Field(default_factory=datetime.utcnow)


class MonitorProbe(BaseModel):
    """Represents a single uptime monitoring probe result"""
    probe_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    tenant_id: uuid.UUID
    deployment_id: Optional[uuid.UUID] = None
    target_url: str
    status_code: int
    latency_ms: int
    health: str  # healthy, degraded, down
    error: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class StressTestResult(BaseModel):
    """Represents results of a resilience/stress test"""
    test_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    tenant_id: uuid.UUID
    deployment_id: Optional[uuid.UUID] = None
    target_url: str
    duration_s: int
    concurrency: int
    total_requests: int
    rps_avg: float
    success_rate_pct: float
    error_count: int
    latency_avg_ms: float
    latency_p95_ms: float
    latency_p99_ms: float
    verdict: str  # RESILIENT, DEGRADED, VULNERABLE
    breaking_point: Optional[Dict[str, Any]] = None
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None

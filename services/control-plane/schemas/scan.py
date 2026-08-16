"""Schemas for Scan and Finding API requests/responses"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid


class ScanCreate(BaseModel):
    """Schema for creating a scan via the API"""
    type: str = Field(..., description="Scan type: url, repository, container, active")
    target: str = Field(..., description="URL or repository URL to scan")
    asset_id: Optional[uuid.UUID] = None
    active_scan: bool = Field(default=False, description="Enable intrusive active scanning (requires authorization)")
    options: Dict[str, Any] = Field(default={}, description="Additional scan options")


class ScanResponse(BaseModel):
    """Schema for scan API response"""
    scan_id: uuid.UUID
    tenant_id: uuid.UUID
    asset_id: Optional[uuid.UUID] = None
    type: str
    target: str
    status: str
    posture_rating: Optional[str] = None
    posture_score: Optional[int] = None
    finding_counts: Dict[str, int] = {}
    total_findings: int = 0
    duration_ms: Optional[int] = None
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class FindingResponse(BaseModel):
    """Schema for finding API response"""
    finding_id: uuid.UUID
    scan_id: uuid.UUID
    tenant_id: uuid.UUID
    asset_id: Optional[uuid.UUID] = None
    type: str
    severity: str
    category: str
    title: Optional[str] = None
    description: str
    endpoint: Optional[str] = None
    evidence: Optional[str] = None
    remediation: Optional[str] = None
    cve_id: Optional[str] = None
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class SecurityGateRequest(BaseModel):
    """Schema for security gate evaluation request"""
    deployment_id: uuid.UUID
    scan_id: uuid.UUID
    policy: Optional[Dict[str, Any]] = None  # Override default policy


class SecurityGateResponse(BaseModel):
    """Schema for security gate evaluation result"""
    passed: bool
    decision: str  # deploy, block, warn
    reason: str
    violations: List[Dict[str, Any]] = []
    critical_findings: int = 0
    high_findings: int = 0


class AssetCreate(BaseModel):
    """Schema for creating an asset"""
    name: str = Field(..., min_length=1, max_length=255)
    type: str = Field(default="web_application")
    description: Optional[str] = None
    git_repo: Optional[str] = None
    git_branch: Optional[str] = "main"
    url: Optional[str] = None
    tags: List[str] = []


class AssetResponse(BaseModel):
    """Schema for asset API response"""
    asset_id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    type: str
    description: Optional[str] = None
    git_repo: Optional[str] = None
    git_branch: Optional[str] = None
    url: Optional[str] = None
    tags: List[str] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

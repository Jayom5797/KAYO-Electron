"""Scan and Finding models — represent security assessments and their results"""
from sqlalchemy import Column, String, Integer, DateTime, JSON, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import uuid
from database import Base


class Scan(Base):
    """
    A Scan represents a security assessment run (URL scan, repo scan, container scan).
    Scans produce Findings and are associated with Assets and optionally Deployments.
    """
    __tablename__ = 'scans'

    scan_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), nullable=False, index=True)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.asset_id', ondelete='SET NULL'), nullable=True, index=True)
    deployment_id = Column(UUID(as_uuid=True), ForeignKey('deployments.deployment_id', ondelete='SET NULL'), nullable=True)
    type = Column(String(50), nullable=False, index=True)  # url, repository, container, active
    target = Column(String(500), nullable=False)
    status = Column(String(50), nullable=False, default='pending', index=True)  # pending, running, completed, failed
    posture_rating = Column(String(20), nullable=True)  # Critical, High, Medium, Low, Good
    posture_score = Column(Integer, nullable=True)  # 0-100
    finding_counts = Column(JSON, default={"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0})
    total_findings = Column(Integer, default=0)
    duration_ms = Column(Integer, nullable=True)
    report_data = Column(JSON, default={})
    error = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    asset = relationship("Asset", back_populates="scans")
    findings = relationship("Finding", back_populates="scan", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Scan(scan_id={self.scan_id}, type={self.type}, status={self.status})>"


class Finding(Base):
    """
    A Finding is an individual security issue discovered during a scan.
    Findings are the canonical unit of security intelligence across KAYO.
    """
    __tablename__ = 'findings'

    finding_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scan_id = Column(UUID(as_uuid=True), ForeignKey('scans.scan_id', ondelete='CASCADE'), nullable=False, index=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), nullable=False, index=True)
    asset_id = Column(UUID(as_uuid=True), ForeignKey('assets.asset_id', ondelete='SET NULL'), nullable=True)
    type = Column(String(100), nullable=False, index=True)  # tls, csp, cors, secret, dependency, vuln, etc.
    severity = Column(String(20), nullable=False, index=True)  # critical, high, medium, low, info
    category = Column(String(100), nullable=False)  # TLS, Headers, CORS, Cookies, Secrets, Dependencies
    title = Column(String(500), nullable=True)
    description = Column(Text, nullable=False)
    endpoint = Column(String(500), nullable=True)
    evidence = Column(Text, nullable=True)
    remediation = Column(Text, nullable=True)
    cve_id = Column(String(50), nullable=True)
    mitre_technique = Column(String(20), nullable=True)
    status = Column(String(50), nullable=False, default='open')  # open, acknowledged, resolved, false_positive
    metadata_ = Column("metadata", JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    scan = relationship("Scan", back_populates="findings")

    def __repr__(self):
        return f"<Finding(finding_id={self.finding_id}, type={self.type}, severity={self.severity})>"

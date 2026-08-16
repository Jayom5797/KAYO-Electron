"""Asset model — represents a tracked application/service in KAYO"""
from sqlalchemy import Column, String, DateTime, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import uuid
from database import Base


class Asset(Base):
    """
    An Asset represents any application, service, or repository tracked by KAYO.
    Assets unify the relationship between assessments, deployments, and incidents.
    """
    __tablename__ = 'assets'

    asset_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    type = Column(String(50), nullable=False, default='web_application')  # web_application, api, repository, service
    description = Column(String(1000), nullable=True)
    git_repo = Column(String(500), nullable=True)
    git_branch = Column(String(255), nullable=True, default='main')
    url = Column(String(500), nullable=True)
    tags = Column(JSON, default=[])
    settings = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    tenant = relationship("Tenant", back_populates="assets")
    scans = relationship("Scan", back_populates="asset", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Asset(asset_id={self.asset_id}, name={self.name}, type={self.type})>"

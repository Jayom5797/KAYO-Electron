from sqlalchemy import Column, String, DateTime, JSON, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import uuid
from database import Base


class Deployment(Base):
    """Deployment model - represents deployed applications"""
    __tablename__ = 'deployments'
    
    deployment_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), nullable=False, index=True)
    app_name = Column(String(255), nullable=False)
    git_repo = Column(String(500), nullable=False)
    git_branch = Column(String(255), nullable=False, default='main')
    git_commit_sha = Column(String(40), nullable=True)
    k8s_namespace = Column(String(63), nullable=False)
    image_name = Column(String(500), nullable=True)
    status = Column(String(50), nullable=False, default='pending')
    env_vars = Column(JSON, default={})
    build_logs = Column(JSON, default=[])
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deployed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationship
    tenant = relationship("Tenant", back_populates="deployments")
    
    def __repr__(self):
        return f"<Deployment(deployment_id={self.deployment_id}, app_name={self.app_name}, status={self.status})>"

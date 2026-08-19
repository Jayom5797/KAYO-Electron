"""Project model — represents an autonomous deployment project"""
from sqlalchemy import Column, String, Integer, DateTime, JSON, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
from database import Base


class Project(Base):
    """
    A Project is a deployed application managed by KAYO.
    Persisted to PostgreSQL so state survives service restarts.
    """
    __tablename__ = 'projects'

    project_id = Column(String(8), primary_key=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    source_url = Column(String(500), nullable=False)
    source_type = Column(String(50), default='github')
    branch = Column(String(100), default='main')
    environment = Column(String(50), default='demo')
    description = Column(Text, nullable=True)
    status = Column(String(50), nullable=False, default='received', index=True)
    endpoint = Column(String(500), nullable=True)
    aws_stack = Column(String(200), nullable=True)
    aws_region = Column(String(50), default='us-east-1')
    security_posture = Column(String(50), nullable=True)
    posture_score = Column(Integer, nullable=True)
    gate_result = Column(String(50), nullable=True)
    image_uri = Column(String(500), nullable=True)
    error = Column(Text, nullable=True)
    asset_id = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    deployed_at = Column(DateTime(timezone=True), nullable=True)

    def to_dict(self):
        return {
            "project_id": self.project_id,
            "tenant_id": str(self.tenant_id),
            "name": self.name,
            "source_url": self.source_url,
            "source_type": self.source_type,
            "branch": self.branch,
            "environment": self.environment,
            "description": self.description,
            "status": self.status,
            "endpoint": self.endpoint,
            "aws_stack": self.aws_stack,
            "aws_region": self.aws_region,
            "security_posture": self.security_posture,
            "posture_score": self.posture_score,
            "gate_result": self.gate_result,
            "image_uri": self.image_uri,
            "error": self.error,
            "asset_id": self.asset_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "deployed_at": self.deployed_at.isoformat() if self.deployed_at else None,
        }

    def __repr__(self):
        return f"<Project(id={self.project_id}, name={self.name}, status={self.status})>"

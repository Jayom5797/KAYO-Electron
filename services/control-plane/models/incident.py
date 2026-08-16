from sqlalchemy import Column, String, DateTime, JSON, Text, ARRAY, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import uuid
from database import Base


class Incident(Base):
    """Security incident model - represents detected attacks"""
    __tablename__ = 'incidents'
    
    incident_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), nullable=False, index=True)
    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    severity = Column(String(20), nullable=False, index=True)
    status = Column(String(20), nullable=False, default='new', index=True)
    attack_pattern = Column(String(100), nullable=True)
    mitre_technique = Column(String(20), nullable=True)
    root_event_id = Column(UUID(as_uuid=True), nullable=True)
    event_chain = Column(ARRAY(UUID(as_uuid=True)), default=[])
    graph_snapshot = Column(JSON, default={})
    ai_summary = Column(Text, nullable=True)
    remediation_steps = Column(JSON, default=[])
    notes = Column(JSON, default=[])
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationship
    tenant = relationship("Tenant", back_populates="incidents")
    
    def __repr__(self):
        return f"<Incident(incident_id={self.incident_id}, severity={self.severity}, status={self.status})>"

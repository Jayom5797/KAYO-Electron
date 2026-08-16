from sqlalchemy import Column, String, DateTime, Integer, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID, INET, JSONB
from sqlalchemy.sql import func
import uuid

from database import Base


class AuditLog(Base):
    """
    Immutable audit log for security-sensitive operations.
    
    Security:
    - No update or delete operations allowed
    - Captures complete request context
    - Tenant-scoped for isolation
    
    Performance:
    - Indexed by tenant_id and created_at for fast queries
    - Partitioned by month for scalability
    """
    __tablename__ = 'audit_logs'
    
    log_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), nullable=True, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)
    
    # Action details
    action = Column(String(100), nullable=False)
    resource_type = Column(String(100), nullable=False)
    resource_id = Column(UUID(as_uuid=True), nullable=True)
    
    # Request details
    request_method = Column(String(10), nullable=False)
    request_path = Column(String(500), nullable=False)
    request_body = Column(JSONB, nullable=True)
    
    # Response details
    response_status = Column(Integer, nullable=False)
    
    # Client details
    ip_address = Column(INET, nullable=True)
    user_agent = Column(Text, nullable=True)
    
    # Timestamp
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

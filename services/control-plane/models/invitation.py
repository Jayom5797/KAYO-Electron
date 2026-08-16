from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import uuid

from database import Base


class Invitation(Base):
    """
    User invitation model for tenant onboarding.
    
    Security:
    - Token stored as hash (SHA256)
    - Single-use tokens
    - Expiration enforcement
    - Tenant-scoped
    
    Performance:
    - Indexed by token_hash for O(1) lookup
    - Indexed by email for duplicate detection
    """
    __tablename__ = 'invitations'
    
    invitation_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), nullable=False, index=True)
    email = Column(String(255), nullable=False, index=True)
    role = Column(String(50), nullable=False, default='member')
    
    # Token (stored as hash)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    
    # Status tracking
    status = Column(String(20), nullable=False, default='pending', index=True)  # pending, accepted, expired, revoked
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    invited_by = Column(UUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)
    
    # Relationships
    tenant = relationship("Tenant", back_populates="invitations")
    inviter = relationship("User", foreign_keys=[invited_by])
    user = relationship("User", foreign_keys=[user_id])

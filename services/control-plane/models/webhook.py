from sqlalchemy import Column, String, DateTime, JSON, Boolean, Integer, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, ARRAY
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import uuid

from database import Base


class Webhook(Base):
    """
    Webhook configuration for event notifications.
    
    Security:
    - HMAC secret for signature verification
    - Tenant-scoped
    - Event type filtering
    
    Performance:
    - Indexed by tenant_id for O(1) lookup
    - Indexed by is_active for filtering
    """
    __tablename__ = 'webhooks'
    
    webhook_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Configuration
    name = Column(String(255), nullable=False)
    url = Column(String(2048), nullable=False)
    secret = Column(String(255), nullable=False)  # HMAC secret
    event_types = Column(ARRAY(String), nullable=False)  # e.g., ["incident.*", "deployment.failed"]
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    
    # Metadata
    description = Column(Text, nullable=True)
    headers = Column(JSON, nullable=True)  # Custom headers
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    last_triggered_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    tenant = relationship("Tenant", back_populates="webhooks")
    deliveries = relationship("WebhookDelivery", back_populates="webhook", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Webhook(webhook_id={self.webhook_id}, name={self.name}, url={self.url})>"


class WebhookDelivery(Base):
    """
    Webhook delivery log for tracking and debugging.
    
    Performance:
    - Indexed by webhook_id for O(1) lookup
    - Indexed by status for filtering
    - Indexed by created_at for time-based queries
    """
    __tablename__ = 'webhook_deliveries'
    
    delivery_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    webhook_id = Column(UUID(as_uuid=True), ForeignKey('webhooks.webhook_id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Delivery details
    event_type = Column(String(255), nullable=False, index=True)
    payload = Column(JSON, nullable=False)
    status = Column(String(50), nullable=False, default='pending', index=True)  # pending, delivered, failed
    
    # Response tracking
    status_code = Column(Integer, nullable=True)
    response_body = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    
    # Retry tracking
    attempts = Column(Integer, nullable=False, default=0)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    
    # Relationships
    webhook = relationship("Webhook", back_populates="deliveries")
    
    def __repr__(self):
        return f"<WebhookDelivery(delivery_id={self.delivery_id}, status={self.status}, attempts={self.attempts})>"

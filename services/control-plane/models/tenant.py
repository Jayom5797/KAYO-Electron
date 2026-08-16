from sqlalchemy import Column, String, DateTime, JSON, Integer, Numeric, Date, BigInteger, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import uuid
from database import Base


class Tenant(Base):
    """Tenant model - represents an organization using KAYO"""
    __tablename__ = 'tenants'
    
    tenant_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    slug = Column(String(63), unique=True, nullable=False, index=True)
    tier = Column(String(50), nullable=False, default='free', index=True)
    settings = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationships
    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    quota = relationship("TenantQuota", back_populates="tenant", uselist=False, cascade="all, delete-orphan")
    subscription = relationship("TenantSubscription", back_populates="tenant", uselist=False, cascade="all, delete-orphan")
    deployments = relationship("Deployment", back_populates="tenant", cascade="all, delete-orphan")
    incidents = relationship("Incident", back_populates="tenant", cascade="all, delete-orphan")
    invitations = relationship("Invitation", back_populates="tenant", cascade="all, delete-orphan")
    webhooks = relationship("Webhook", back_populates="tenant", cascade="all, delete-orphan")
    assets = relationship("Asset", back_populates="tenant", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<Tenant(tenant_id={self.tenant_id}, name={self.name}, tier={self.tier})>"


class TenantQuota(Base):
    """Resource quotas per tenant based on subscription tier"""
    __tablename__ = 'tenant_quotas'
    
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), primary_key=True)
    max_deployments = Column(Integer, nullable=False, default=1)
    max_cpu_cores = Column(Integer, nullable=False, default=2)
    max_memory_gb = Column(Integer, nullable=False, default=4)
    max_storage_gb = Column(Integer, nullable=False, default=10)
    event_retention_days = Column(Integer, nullable=False, default=7)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Relationship
    tenant = relationship("Tenant", back_populates="quota")
    
    def __repr__(self):
        return f"<TenantQuota(tenant_id={self.tenant_id}, max_deployments={self.max_deployments})>"


class TenantSubscription(Base):
    """Subscription and billing information"""
    __tablename__ = 'tenant_subscriptions'
    
    subscription_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), nullable=False)
    tier = Column(String(50), nullable=False)
    status = Column(String(50), nullable=False, default='active')
    billing_cycle = Column(String(20), nullable=False, default='monthly')
    current_period_start = Column(DateTime(timezone=True), nullable=False)
    current_period_end = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    
    # Relationship
    tenant = relationship("Tenant", back_populates="subscription")
    
    def __repr__(self):
        return f"<TenantSubscription(tenant_id={self.tenant_id}, tier={self.tier}, status={self.status})>"


class TenantUsage(Base):
    """Daily usage tracking for billing and quota enforcement"""
    __tablename__ = 'tenant_usage'
    
    usage_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey('tenants.tenant_id', ondelete='CASCADE'), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    events_ingested = Column(BigInteger, nullable=False, default=0)
    storage_gb = Column(Numeric(10, 2), nullable=False, default=0)
    compute_hours = Column(Numeric(10, 2), nullable=False, default=0)
    graph_queries = Column(BigInteger, nullable=False, default=0)
    ai_tokens = Column(BigInteger, nullable=False, default=0)
    
    def __repr__(self):
        return f"<TenantUsage(tenant_id={self.tenant_id}, date={self.date}, events={self.events_ingested})>"

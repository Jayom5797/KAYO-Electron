from pydantic import BaseModel, Field, validator
from typing import Optional, Dict
from datetime import datetime
import uuid
import re


class TenantCreate(BaseModel):
    """Schema for creating a new tenant"""
    name: str = Field(..., min_length=1, max_length=255, description="Organization name")
    slug: str = Field(..., min_length=3, max_length=63, description="URL-safe identifier")
    tier: str = Field(default="free", description="Subscription tier")
    
    @validator('slug')
    def validate_slug(cls, v):
        """Ensure slug is URL-safe (lowercase alphanumeric and hyphens only)"""
        if not re.match(r'^[a-z0-9-]+$', v):
            raise ValueError('Slug must contain only lowercase letters, numbers, and hyphens')
        if v.startswith('-') or v.endswith('-'):
            raise ValueError('Slug cannot start or end with a hyphen')
        return v
    
    @validator('tier')
    def validate_tier(cls, v):
        """Validate subscription tier"""
        valid_tiers = ['free', 'pro', 'enterprise']
        if v not in valid_tiers:
            raise ValueError(f'Tier must be one of: {", ".join(valid_tiers)}')
        return v


class TenantUpdate(BaseModel):
    """Schema for updating tenant settings"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    settings: Optional[Dict] = None


class TenantResponse(BaseModel):
    """Schema for tenant response"""
    tenant_id: uuid.UUID
    name: str
    slug: str
    tier: str
    settings: Dict
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

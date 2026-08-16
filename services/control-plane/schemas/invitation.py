from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime
import uuid


class InvitationCreate(BaseModel):
    """Schema for creating invitation"""
    email: EmailStr = Field(..., description="Email address to invite")
    role: str = Field(default="member", description="User role (member, admin)")
    
    class Config:
        json_schema_extra = {
            "example": {
                "email": "analyst@security-team.com",
                "role": "member"
            }
        }


class InvitationResponse(BaseModel):
    """Schema for invitation response"""
    invitation_id: uuid.UUID
    tenant_id: uuid.UUID
    email: str
    role: str
    status: str
    created_at: datetime
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    invited_by: Optional[uuid.UUID] = None
    user_id: Optional[uuid.UUID] = None
    invitation_link: Optional[str] = None  # Only included when creating
    
    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "invitation_id": "550e8400-e29b-41d4-a716-446655440000",
                "tenant_id": "660e8400-e29b-41d4-a716-446655440000",
                "email": "analyst@security-team.com",
                "role": "member",
                "status": "pending",
                "created_at": "2026-03-12T10:00:00Z",
                "expires_at": "2026-03-19T10:00:00Z",
                "accepted_at": None,
                "invited_by": "770e8400-e29b-41d4-a716-446655440000",
                "user_id": None
            }
        }

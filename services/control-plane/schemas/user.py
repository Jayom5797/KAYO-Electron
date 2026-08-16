from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime
import uuid


class UserCreate(BaseModel):
    """Schema for creating a new user"""
    email: EmailStr
    password: str = Field(..., min_length=8, description="Password must be at least 8 characters")
    role: str = Field(default="member", description="User role")


class UserLogin(BaseModel):
    """Schema for user login"""
    email: EmailStr
    password: str


class Token(BaseModel):
    """Schema for JWT token response"""
    access_token: str
    token_type: str = "bearer"
    tenant_id: uuid.UUID
    user_id: uuid.UUID


class UserResponse(BaseModel):
    """Schema for user response"""
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    email: str
    role: str
    created_at: datetime
    last_login_at: Optional[datetime]
    
    class Config:
        from_attributes = True

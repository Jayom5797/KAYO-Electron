from pydantic import BaseModel, Field, HttpUrl
from typing import Optional, Dict, List
from datetime import datetime
import uuid


class DeploymentCreate(BaseModel):
    """Schema for creating a new deployment"""
    app_name: str = Field(..., min_length=1, max_length=255, description="Application name")
    git_repo: str = Field(..., description="Git repository URL")
    git_branch: str = Field(default="main", description="Git branch to deploy")
    env_vars: Dict[str, str] = Field(default={}, description="Environment variables")


class DeploymentUpdate(BaseModel):
    """Schema for updating deployment"""
    git_branch: Optional[str] = None
    env_vars: Optional[Dict[str, str]] = None
    status: Optional[str] = None


class DeploymentResponse(BaseModel):
    """Schema for deployment response"""
    deployment_id: uuid.UUID
    tenant_id: uuid.UUID
    app_name: str
    git_repo: str
    git_branch: str
    git_commit_sha: Optional[str]
    k8s_namespace: str
    image_name: Optional[str]
    status: str
    env_vars: Dict
    created_at: datetime
    updated_at: datetime
    deployed_at: Optional[datetime]
    
    class Config:
        from_attributes = True

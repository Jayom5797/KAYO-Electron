from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
import logging

from database import get_db
from models.audit_log import AuditLog
from services.auth import get_current_user, get_current_tenant_id
from models.user import User
from pydantic import BaseModel
from datetime import datetime

router = APIRouter(prefix="/api/audit-logs", tags=["audit-logs"])
logger = logging.getLogger(__name__)


class AuditLogResponse(BaseModel):
    log_id: uuid.UUID
    tenant_id: Optional[uuid.UUID] = None
    user_id: Optional[uuid.UUID] = None
    action: str
    resource_type: str
    resource_id: Optional[uuid.UUID] = None
    request_method: str
    request_path: str
    response_status: int
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/", response_model=List[AuditLogResponse])
async def list_audit_logs(
    skip: int = 0,
    limit: int = 100,
    action: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """List audit logs for current tenant, newest first."""
    query = db.query(AuditLog).filter(AuditLog.tenant_id == tenant_id)

    if action:
        query = query.filter(AuditLog.action.ilike(f"%{action}%"))
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)

    logs = query.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit).all()
    return logs

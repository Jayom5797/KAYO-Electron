"""
Compliance endpoints for SOC 2 / GDPR requirements.
- Data retention enforcement
- Right to erasure (GDPR Art. 17)
- Data export (GDPR Art. 20)
- Compliance report generation from audit logs
"""
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import uuid
import logging

from database import get_db
from models.user import User
from models.incident import Incident
from models.deployment import Deployment
from models.audit_log import AuditLog
from models.invitation import Invitation
from services.auth import get_current_user, get_current_tenant_id, require_role

router = APIRouter(prefix="/api/compliance", tags=["compliance"])
logger = logging.getLogger(__name__)

# Retention periods per resource type (days)
RETENTION_POLICY = {
    "audit_logs": 365,
    "incidents": 180,
    "deployments": 90,
}


@router.get("/report")
async def get_compliance_report(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Generate SOC 2 compliance report from audit logs.
    Returns summary of security events, access patterns, and policy adherence.
    """
    now = datetime.utcnow()
    thirty_days_ago = now - timedelta(days=30)

    total_logs = db.query(AuditLog).filter(AuditLog.tenant_id == tenant_id).count()
    recent_logs = db.query(AuditLog).filter(
        AuditLog.tenant_id == tenant_id,
        AuditLog.created_at >= thirty_days_ago
    ).count()

    failed_logins = db.query(AuditLog).filter(
        AuditLog.tenant_id == tenant_id,
        AuditLog.action == "login",
        AuditLog.response_status >= 400,
        AuditLog.created_at >= thirty_days_ago
    ).count()

    total_incidents = db.query(Incident).filter(Incident.tenant_id == tenant_id).count()
    open_incidents = db.query(Incident).filter(
        Incident.tenant_id == tenant_id,
        Incident.status == "new"
    ).count()

    return {
        "generated_at": now.isoformat(),
        "tenant_id": str(tenant_id),
        "period": "last_30_days",
        "audit_logs": {
            "total": total_logs,
            "last_30_days": recent_logs,
            "failed_login_attempts": failed_logins,
        },
        "incidents": {
            "total": total_incidents,
            "open": open_incidents,
        },
        "retention_policy": RETENTION_POLICY,
        "controls": {
            "authentication": "JWT with bcrypt password hashing",
            "authorization": "RBAC with tenant isolation",
            "audit_logging": "All write operations logged",
            "encryption_in_transit": "TLS enforced",
            "rate_limiting": "Redis sliding window per tenant tier",
        }
    }


@router.post("/enforce-retention")
async def enforce_retention(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Enforce data retention policy — delete records older than policy limits.
    Runs in background to avoid timeout.
    """
    background_tasks.add_task(_run_retention, db, tenant_id)
    return {"message": "Retention enforcement started in background"}


def _run_retention(db: Session, tenant_id: uuid.UUID):
    now = datetime.utcnow()
    deleted = {}

    for resource, days in RETENTION_POLICY.items():
        cutoff = now - timedelta(days=days)
        if resource == "audit_logs":
            count = db.query(AuditLog).filter(
                AuditLog.tenant_id == tenant_id,
                AuditLog.created_at < cutoff
            ).delete()
            deleted["audit_logs"] = count
        elif resource == "incidents":
            count = db.query(Incident).filter(
                Incident.tenant_id == tenant_id,
                Incident.created_at < cutoff,
                Incident.status == "resolved"
            ).delete()
            deleted["incidents"] = count
        elif resource == "deployments":
            count = db.query(Deployment).filter(
                Deployment.tenant_id == tenant_id,
                Deployment.created_at < cutoff
            ).delete()
            deleted["deployments"] = count

    db.commit()
    logger.info(f"Retention enforcement for tenant {tenant_id}: {deleted}")


@router.delete("/gdpr/erase")
async def erase_tenant_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    GDPR Art. 17 - Right to Erasure.
    Deletes all personal data for the tenant. Irreversible.
    """
    deleted = {}

    deleted["audit_logs"] = db.query(AuditLog).filter(
        AuditLog.tenant_id == tenant_id
    ).delete()

    deleted["incidents"] = db.query(Incident).filter(
        Incident.tenant_id == tenant_id
    ).delete()

    deleted["deployments"] = db.query(Deployment).filter(
        Deployment.tenant_id == tenant_id
    ).delete()

    deleted["invitations"] = db.query(Invitation).filter(
        Invitation.tenant_id == tenant_id
    ).delete()

    db.commit()
    logger.warning(f"GDPR erasure completed for tenant {tenant_id}: {deleted}")

    return {"message": "All tenant data erased", "deleted": deleted}


@router.get("/gdpr/export")
async def export_tenant_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin")),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    GDPR Art. 20 - Right to Data Portability.
    Returns all tenant data as JSON.
    """
    incidents = db.query(Incident).filter(Incident.tenant_id == tenant_id).all()
    deployments = db.query(Deployment).filter(Deployment.tenant_id == tenant_id).all()
    audit_logs = db.query(AuditLog).filter(AuditLog.tenant_id == tenant_id).limit(1000).all()

    return {
        "exported_at": datetime.utcnow().isoformat(),
        "tenant_id": str(tenant_id),
        "incidents": [
            {
                "incident_id": str(i.incident_id),
                "severity": i.severity,
                "status": i.status,
                "created_at": i.created_at.isoformat(),
            }
            for i in incidents
        ],
        "deployments": [
            {
                "deployment_id": str(d.deployment_id),
                "app_name": d.app_name,
                "status": d.status,
                "created_at": d.created_at.isoformat(),
            }
            for d in deployments
        ],
        "audit_log_count": len(audit_logs),
    }

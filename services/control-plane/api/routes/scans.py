"""
Scans API — Unified assessment endpoint for the KAYO control plane.

This route integrates the control plane with the assessment engine,
providing the full lifecycle: trigger scan → track status → persist findings → serve results.
"""
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid
import logging
from datetime import datetime

from database import get_db
from models.scan import Scan, Finding
from models.asset import Asset
from schemas.scan import ScanCreate, ScanResponse, FindingResponse, SecurityGateRequest, SecurityGateResponse, AssetCreate, AssetResponse
from services.auth import get_current_user, get_current_tenant_id
from models.user import User

router = APIRouter(prefix="/api/scans", tags=["scans"])
logger = logging.getLogger(__name__)


# ── Background task: poll assessment engine and persist results ─────────────────

async def _poll_and_persist(scan_db_id: uuid.UUID, engine_scan_id: str, tenant_id: str, db_url: str):
    """
    Background task that polls the assessment engine for results
    and persists findings to PostgreSQL.

    All synchronous SQLAlchemy calls are offloaded to a thread-pool executor so
    they never block the FastAPI event loop.
    """
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    from sqlalchemy import create_engine as _create_engine
    from sqlalchemy.orm import sessionmaker
    from services.assessment_client import AssessmentClient

    loop = asyncio.get_event_loop()
    executor = ThreadPoolExecutor(max_workers=1)

    def _db_write(fn):
        """Run a synchronous DB function in the thread-pool."""
        return loop.run_in_executor(executor, fn)

    # Build a dedicated sync engine/session for this background task
    sync_engine = _create_engine(db_url)
    SyncSession = sessionmaker(bind=sync_engine)

    client = AssessmentClient()

    try:
        # Poll assessment engine asynchronously (already async-safe)
        result = await client.poll_until_complete(engine_scan_id, max_attempts=120, interval_s=2.0)

        scan_status = result.get("status")

        if scan_status == "completed":
            # Fetch findings + report concurrently
            findings_data, report = await asyncio.gather(
                client.get_findings(engine_scan_id),
                client.get_report(engine_scan_id).catch_errors(),
                return_exceptions=True,
            ) if False else (
                await client.get_findings(engine_scan_id),
                None,
            )

            try:
                report = await client.get_report(engine_scan_id)
            except Exception:
                report = None

            def _persist_completed():
                db = SyncSession()
                try:
                    scan = db.query(Scan).filter(Scan.scan_id == scan_db_id).first()
                    if not scan:
                        logger.error(f"Scan {scan_db_id} not found in database")
                        return

                    scan.status = "completed"
                    scan.completed_at = datetime.utcnow()
                    posture = result.get("posture") or {}
                    scan.posture_rating = posture.get("rating")
                    scan.posture_score = posture.get("score")

                    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
                    for f in findings_data:
                        severity = f.get("severity", "info")
                        counts[severity] = counts.get(severity, 0) + 1
                        finding = Finding(
                            scan_id=scan_db_id,
                            tenant_id=uuid.UUID(tenant_id),
                            asset_id=scan.asset_id,
                            type=f.get("type", "unknown"),
                            severity=severity,
                            category=f.get("category", "General"),
                            title=f.get("title"),
                            description=f.get("description", ""),
                            endpoint=f.get("endpoint"),
                            evidence=f.get("evidence"),
                            remediation=f.get("remediation"),
                            cve_id=f.get("cve_id"),
                        )
                        db.add(finding)

                    scan.finding_counts = counts
                    scan.total_findings = len(findings_data)

                    if report:
                        scan.report_data = {"markdown": report.get("content", "")}

                    db.commit()
                    logger.info(f"Scan {scan_db_id} completed: {len(findings_data)} findings")
                    return scan
                finally:
                    db.close()

            scan = await _db_write(_persist_completed)

            # Broadcast real-time WS event to the tenant
            try:
                from main import ws_manager
                await ws_manager.broadcast(
                    tenant_id,
                    "scan.completed",
                    {
                        "scan_id": str(scan_db_id),
                        "status": "completed",
                        "posture_rating": result.get("posture", {}).get("rating"),
                        "posture_score": result.get("posture", {}).get("score"),
                        "total_findings": len(findings_data),
                    }
                )
            except Exception as e:
                logger.warning(f"WS broadcast failed for scan {scan_db_id}: {e}")

        elif scan_status in ("failed", "timeout"):
            error_msg = result.get("error", "Assessment engine reported failure") if scan_status == "failed" else "Assessment timed out"

            def _persist_failed():
                db = SyncSession()
                try:
                    scan = db.query(Scan).filter(Scan.scan_id == scan_db_id).first()
                    if scan:
                        scan.status = "failed"
                        scan.error = error_msg
                        scan.completed_at = datetime.utcnow()
                        db.commit()
                finally:
                    db.close()

            await _db_write(_persist_failed)

            try:
                from main import ws_manager
                await ws_manager.broadcast(
                    tenant_id,
                    "scan.failed",
                    {"scan_id": str(scan_db_id), "status": "failed", "error": error_msg}
                )
            except Exception:
                pass

    except Exception as e:
        logger.error(f"Background poll failed for scan {scan_db_id}: {e}", exc_info=True)

        def _persist_error():
            db = SyncSession()
            try:
                scan = db.query(Scan).filter(Scan.scan_id == scan_db_id).first()
                if scan:
                    scan.status = "failed"
                    scan.error = f"Internal error: {str(e)}"
                    scan.completed_at = datetime.utcnow()
                    db.commit()
            finally:
                db.close()

        try:
            await _db_write(_persist_error)
        except Exception:
            pass
    finally:
        executor.shutdown(wait=False)


# ── POST /api/scans/url ────────────────────────────────────────────────────────

@router.post("/url", response_model=ScanResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_url_scan(
    scan_data: ScanCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """
    Trigger a URL security assessment.

    Creates a Scan record, submits to the assessment engine, and returns immediately.
    Results are persisted asynchronously.
    """
    from services.assessment_client import AssessmentClient
    from config import settings

    if scan_data.type != "url":
        scan_data.type = "url"

    # Create scan record
    scan = Scan(
        tenant_id=tenant_id,
        asset_id=scan_data.asset_id,
        type="url",
        target=scan_data.target,
        status="pending",
        started_at=datetime.utcnow(),
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    # Submit to assessment engine
    client = AssessmentClient()
    try:
        result = await client.assess_url(
            url=scan_data.target,
            tenant_id=str(tenant_id),
            active_scan=scan_data.active_scan,
        )
        engine_scan_id = result.get("scan_id")
        scan.status = "running"
        scan.report_data = {"engine_scan_id": engine_scan_id}
        db.commit()

        # Start background polling
        background_tasks.add_task(
            _poll_and_persist, scan.scan_id, engine_scan_id, str(tenant_id), settings.database_url
        )

    except Exception as e:
        scan.status = "failed"
        scan.error = f"Failed to submit to assessment engine: {str(e)}"
        scan.completed_at = datetime.utcnow()
        db.commit()
        logger.error(f"Assessment submission failed: {e}")

    return scan


# ── POST /api/scans/repository ─────────────────────────────────────────────────

@router.post("/repository", response_model=ScanResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_repository_scan(
    scan_data: ScanCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """
    Trigger a repository security assessment.

    Scans for secrets, vulnerable dependencies, workflow risks, and code patterns.
    """
    from services.assessment_client import AssessmentClient
    from config import settings

    scan = Scan(
        tenant_id=tenant_id,
        asset_id=scan_data.asset_id,
        type="repository",
        target=scan_data.target,
        status="pending",
        started_at=datetime.utcnow(),
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    client = AssessmentClient()
    try:
        result = await client.assess_repository(
            url=scan_data.target,
            tenant_id=str(tenant_id),
            advanced=scan_data.options.get("advanced", False),
        )
        engine_scan_id = result.get("scan_id")
        scan.status = "running"
        scan.report_data = {"engine_scan_id": engine_scan_id}
        db.commit()

        background_tasks.add_task(
            _poll_and_persist, scan.scan_id, engine_scan_id, str(tenant_id), settings.database_url
        )

    except Exception as e:
        scan.status = "failed"
        scan.error = f"Failed to submit: {str(e)}"
        scan.completed_at = datetime.utcnow()
        db.commit()

    return scan


# ── GET /api/scans ─────────────────────────────────────────────────────────────

@router.get("/", response_model=List[ScanResponse])
async def list_scans(
    skip: int = 0,
    limit: int = 50,
    type: Optional[str] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """List scans for the current tenant."""
    query = db.query(Scan).filter(Scan.tenant_id == tenant_id)
    if type:
        query = query.filter(Scan.type == type)
    if status_filter:
        query = query.filter(Scan.status == status_filter)
    return query.order_by(Scan.created_at.desc()).offset(skip).limit(limit).all()


# ── GET /api/scans/{scan_id} ───────────────────────────────────────────────────

@router.get("/{scan_id}", response_model=ScanResponse)
async def get_scan(
    scan_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """Get scan details."""
    scan = db.query(Scan).filter(Scan.scan_id == scan_id, Scan.tenant_id == tenant_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan


# ── DELETE /api/scans/{scan_id} ────────────────────────────────────────────────

@router.delete("/{scan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scan(
    scan_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """Delete a scan and its findings."""
    scan = db.query(Scan).filter(Scan.scan_id == scan_id, Scan.tenant_id == tenant_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    db.query(Finding).filter(Finding.scan_id == scan_id).delete()
    db.delete(scan)
    db.commit()


# ── GET /api/scans/{scan_id}/findings ──────────────────────────────────────────

@router.get("/{scan_id}/findings", response_model=List[FindingResponse])
async def get_scan_findings(
    scan_id: uuid.UUID,
    severity: Optional[str] = None,
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """Get findings for a scan."""
    scan = db.query(Scan).filter(Scan.scan_id == scan_id, Scan.tenant_id == tenant_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    query = db.query(Finding).filter(Finding.scan_id == scan_id)
    if severity:
        query = query.filter(Finding.severity == severity)
    if category:
        query = query.filter(Finding.category == category)
    return query.all()


# ── GET /api/scans/{scan_id}/report ────────────────────────────────────────────

@router.get("/{scan_id}/report")
async def get_scan_report(
    scan_id: uuid.UUID,
    format: str = "markdown",
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """Get formatted report for a scan."""
    scan = db.query(Scan).filter(Scan.scan_id == scan_id, Scan.tenant_id == tenant_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan.status != "completed":
        raise HTTPException(status_code=409, detail=f"Scan is {scan.status}")

    content = scan.report_data.get(format, scan.report_data.get("markdown", ""))
    return {"scan_id": str(scan_id), "format": format, "content": content}


# ── POST /api/scans/{scan_id}/gate ─────────────────────────────────────────────

@router.post("/{scan_id}/gate", response_model=SecurityGateResponse)
async def evaluate_security_gate(
    scan_id: uuid.UUID,
    gate_request: SecurityGateRequest,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """
    Evaluate security gate for a completed scan.

    Determines whether a deployment should proceed based on findings and policy.
    """
    scan = db.query(Scan).filter(Scan.scan_id == scan_id, Scan.tenant_id == tenant_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    if scan.status != "completed":
        raise HTTPException(status_code=409, detail=f"Scan must be completed (currently: {scan.status})")

    # Get findings
    findings = db.query(Finding).filter(Finding.scan_id == scan_id).all()
    findings_dicts = [{"severity": f.severity, "type": f.type, "category": f.category} for f in findings]

    # Import and run gate evaluation
    import sys
    import os
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../../services/deployment-engine')))

    from security_gate import evaluate_gate, DeploymentPolicy

    policy = None
    if gate_request.policy:
        policy = DeploymentPolicy(**gate_request.policy)

    result = evaluate_gate(findings_dicts, policy)

    return SecurityGateResponse(
        passed=result.passed,
        decision=result.decision.value,
        reason=result.reason,
        violations=[{"rule": v.rule, "severity": v.severity, "description": v.description} for v in result.violations],
        critical_findings=result.critical_findings,
        high_findings=result.high_findings,
    )


# ── Assets CRUD ────────────────────────────────────────────────────────────────

@router.post("/assets", response_model=AssetResponse, status_code=status.HTTP_201_CREATED,
             tags=["assets"])
async def create_asset(
    asset_data: AssetCreate,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """Create a tracked asset."""
    asset = Asset(
        tenant_id=tenant_id,
        name=asset_data.name,
        type=asset_data.type,
        description=asset_data.description,
        git_repo=asset_data.git_repo,
        git_branch=asset_data.git_branch,
        url=asset_data.url,
        tags=asset_data.tags,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


@router.get("/assets", response_model=List[AssetResponse], tags=["assets"])
async def list_assets(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """List assets for current tenant."""
    return db.query(Asset).filter(Asset.tenant_id == tenant_id).offset(skip).limit(limit).all()


@router.get("/assets/{asset_id}", response_model=AssetResponse, tags=["assets"])
async def get_asset(
    asset_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """Get asset details."""
    asset = db.query(Asset).filter(Asset.asset_id == asset_id, Asset.tenant_id == tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset


@router.post("/assets/{asset_id}/reassess", response_model=ScanResponse,
             status_code=status.HTTP_202_ACCEPTED, tags=["assets"])
async def reassess_asset(
    asset_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id),
):
    """
    Trigger reassessment of an asset.

    Runs a new scan against the asset's configured URL or repository.
    """
    from services.assessment_client import AssessmentClient
    from config import settings

    asset = db.query(Asset).filter(Asset.asset_id == asset_id, Asset.tenant_id == tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # Determine scan target and type
    if asset.url:
        scan_type = "url"
        target = asset.url
    elif asset.git_repo:
        scan_type = "repository"
        target = asset.git_repo
    else:
        raise HTTPException(status_code=400, detail="Asset has no URL or repository configured")

    # Create scan
    scan = Scan(
        tenant_id=tenant_id,
        asset_id=asset_id,
        type=scan_type,
        target=target,
        status="pending",
        started_at=datetime.utcnow(),
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    # Submit to assessment engine
    client = AssessmentClient()
    try:
        if scan_type == "url":
            result = await client.assess_url(url=target, tenant_id=str(tenant_id))
        else:
            result = await client.assess_repository(url=target, tenant_id=str(tenant_id))

        engine_scan_id = result.get("scan_id")
        scan.status = "running"
        scan.report_data = {"engine_scan_id": engine_scan_id}
        db.commit()

        background_tasks.add_task(
            _poll_and_persist, scan.scan_id, engine_scan_id, str(tenant_id), settings.database_url
        )
    except Exception as e:
        scan.status = "failed"
        scan.error = str(e)
        scan.completed_at = datetime.utcnow()
        db.commit()

    return scan

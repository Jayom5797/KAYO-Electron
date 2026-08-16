from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid
import logging

from database import get_db
from models.incident import Incident
from schemas.incident import IncidentResponse, IncidentUpdate
from services.auth import get_current_tenant_id
from config import settings

router = APIRouter(prefix="/api/incidents", tags=["incidents"])
logger = logging.getLogger(__name__)


@router.get("/", response_model=List[IncidentResponse])
async def list_incidents(
    skip: int = 0,
    limit: int = 100,
    severity: str = None,
    status_filter: str = None,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    List security incidents for current tenant.
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(n) where n is number of incidents (limited by pagination)
    """
    query = db.query(Incident).filter(Incident.tenant_id == tenant_id)
    
    if severity:
        query = query.filter(Incident.severity == severity)
    if status_filter:
        query = query.filter(Incident.status == status_filter)
    
    incidents = query.order_by(Incident.created_at.desc()).offset(skip).limit(limit).all()
    return incidents


@router.get("/{incident_id}", response_model=IncidentResponse)
async def get_incident(
    incident_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Get incident details including attack graph and AI explanation.
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(1) - indexed lookup
    """
    incident = (
        db.query(Incident)
        .filter(
            Incident.incident_id == incident_id,
            Incident.tenant_id == tenant_id
        )
        .first()
    )
    
    if not incident:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    
    return incident


@router.patch("/{incident_id}", response_model=IncidentResponse)
async def update_incident(
    incident_id: uuid.UUID,
    incident_update: IncidentUpdate,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Update incident status (e.g., mark as resolved).
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(1)
    """
    incident = (
        db.query(Incident)
        .filter(
            Incident.incident_id == incident_id,
            Incident.tenant_id == tenant_id
        )
        .first()
    )
    
    if not incident:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
    
    # Track changes for webhook
    changes = {}
    old_status = incident.status
    
    if incident_update.status is not None:
        changes['status'] = {'old': old_status, 'new': incident_update.status}
        incident.status = incident_update.status
        if incident_update.status == "resolved":
            from datetime import datetime
            incident.resolved_at = datetime.utcnow()
            changes['resolved_at'] = incident.resolved_at.isoformat()
    
    if incident_update.notes is not None:
        incident.notes = incident_update.notes
        changes['notes_updated'] = True
    
    db.commit()
    db.refresh(incident)
    
    logger.info(f"Updated incident: {incident_id} to status: {incident.status}")
    
    # Broadcast webhook event
    from services.event_broadcaster import EventBroadcaster
    broadcaster = EventBroadcaster(db)
    
    incident_data = {
        'title': incident.title,
        'severity': incident.severity,
        'status': incident.status,
        'resolved_at': incident.resolved_at.isoformat() if incident.resolved_at else None
    }
    
    if incident.status == 'resolved':
        broadcaster.broadcast_incident_resolved_sync(tenant_id, incident_id, incident_data)
    else:
        broadcaster.broadcast_incident_updated_sync(tenant_id, incident_id, incident_data, changes)
    
    # Push real-time WebSocket event
    try:
        from main import ws_manager
        import asyncio
        loop = asyncio.get_event_loop()
        loop.create_task(ws_manager.broadcast(
            str(tenant_id),
            "incident.updated",
            {"incident_id": str(incident_id), **incident_data}
        ))
    except Exception as e:
        logger.warning(f"WS broadcast failed: {e}")
    
    return incident


@router.get("/{incident_id}/attack-path")
async def get_attack_path(
    incident_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """Reconstruct attack path for incident using Neo4j graph traversal."""
    from neo4j import GraphDatabase
    from models.tenant import Tenant

    incident = (
        db.query(Incident)
        .filter(Incident.incident_id == incident_id, Incident.tenant_id == tenant_id)
        .first()
    )
    if not incident:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")

    tenant = db.query(Tenant).filter(Tenant.tenant_id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")

    neo4j_database = tenant.settings.get('neo4j_database') if tenant.settings else None
    if not neo4j_database:
        # Return graph snapshot from incident if Neo4j not provisioned
        return {
            "incident_id": str(incident_id),
            "graph_snapshot": incident.graph_snapshot or {},
            "attack_chain": [],
            "confidence_score": 0.0,
            "message": "Graph database not provisioned for this tenant"
        }

    try:
        driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password)
        )
        import sys, os
        detection_engine_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), '../../../../services/detection-engine')
        )
        if detection_engine_path not in sys.path:
            sys.path.insert(0, detection_engine_path)
        from attack_path_reconstructor import AttackPathReconstructor

        reconstructor = AttackPathReconstructor(driver, neo4j_database)
        incident_data = {
            'incident_id': str(incident.incident_id),
            'graph_snapshot': incident.graph_snapshot or {}
        }
        attack_path = reconstructor.reconstruct_attack_path(incident_data, max_depth=10)
        logger.info(f"Reconstructed attack path for incident {incident_id}")
        return attack_path

    except ImportError:
        logger.warning("AttackPathReconstructor not available, returning graph snapshot")
        return {
            "incident_id": str(incident_id),
            "graph_snapshot": incident.graph_snapshot or {},
            "attack_chain": [],
            "confidence_score": 0.0,
        }
    except Exception as e:
        logger.error(f"Failed to reconstruct attack path: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reconstruct attack path: {str(e)}"
        )
    finally:
        try:
            driver.close()
        except Exception:
            pass


@router.post("/{incident_id}/explain")
async def generate_explanation(
    incident_id: uuid.UUID,
    force_regenerate: bool = False,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """Generate AI-powered explanation for incident."""
    incident = (
        db.query(Incident)
        .filter(Incident.incident_id == incident_id, Incident.tenant_id == tenant_id)
        .first()
    )
    if not incident:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")

    # If AI summary already exists and not forcing regeneration, return cached
    if incident.ai_summary and not force_regenerate:
        return {
            "incident_id": str(incident_id),
            "technical_summary": incident.ai_summary,
            "cached": True
        }

    try:
        import sys, os
        ai_explainer_path = os.path.abspath(
            os.path.join(os.path.dirname(__file__), '../../../../services/ai-explainer')
        )
        if ai_explainer_path not in sys.path:
            sys.path.insert(0, ai_explainer_path)
        from explanation_service import ExplanationService

        service = ExplanationService()
        await service.initialize()

        within_limits = await service.check_rate_limit(str(tenant_id))
        if not within_limits:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Daily token limit exceeded. Please try again tomorrow."
            )

        explanation = await service.generate_incident_explanation(
            str(incident_id), str(tenant_id), force_regenerate=force_regenerate
        )
        incident.ai_summary = explanation.get('technical_summary')
        db.commit()
        logger.info(f"Generated AI explanation for incident {incident_id}")
        return explanation

    except ImportError:
        logger.warning("ExplanationService not available")
        return {
            "incident_id": str(incident_id),
            "technical_summary": "AI explanation service not available in this environment.",
            "cached": False
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate explanation: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate explanation: {str(e)}"
        )

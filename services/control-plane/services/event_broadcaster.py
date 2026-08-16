import logging
import asyncio
from typing import Dict, Any
from sqlalchemy.orm import Session
import uuid

from services.webhook_service import WebhookService

logger = logging.getLogger(__name__)


class EventBroadcaster:
    """
    Broadcasts events to configured webhooks.
    
    Handles:
    - Incident events (created, updated, resolved)
    - Deployment events (created, updated, failed, succeeded)
    - Alert events (triggered)
    
    Architecture:
    - Async broadcasting (non-blocking)
    - Automatic webhook discovery per tenant
    - Event type filtering
    
    Time complexity: O(n) where n is number of webhooks per tenant
    """
    
    def __init__(self, db: Session):
        """
        Initialize event broadcaster.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    async def broadcast_incident_created(
        self,
        tenant_id: uuid.UUID,
        incident_id: uuid.UUID,
        incident_data: Dict[str, Any]
    ):
        """
        Broadcast incident.created event.
        
        Args:
            tenant_id: Tenant UUID
            incident_id: Incident UUID
            incident_data: Incident details
        
        Time complexity: O(n) where n is number of webhooks
        """
        event_type = "incident.created"
        payload = {
            "incident_id": str(incident_id),
            "title": incident_data.get("title"),
            "description": incident_data.get("description"),
            "severity": incident_data.get("severity"),
            "status": incident_data.get("status"),
            "detected_at": incident_data.get("detected_at"),
            "mitre_tactics": incident_data.get("mitre_tactics", []),
            "mitre_techniques": incident_data.get("mitre_techniques", []),
            "affected_entities": incident_data.get("affected_entities", []),
        }
        
        await self._broadcast_event(tenant_id, event_type, payload)
        logger.info(f"Broadcasted incident.created for {incident_id}")
    
    async def broadcast_incident_updated(
        self,
        tenant_id: uuid.UUID,
        incident_id: uuid.UUID,
        incident_data: Dict[str, Any],
        changes: Dict[str, Any]
    ):
        """
        Broadcast incident.updated event.
        
        Args:
            tenant_id: Tenant UUID
            incident_id: Incident UUID
            incident_data: Current incident details
            changes: Fields that changed
        
        Time complexity: O(n) where n is number of webhooks
        """
        event_type = "incident.updated"
        payload = {
            "incident_id": str(incident_id),
            "title": incident_data.get("title"),
            "severity": incident_data.get("severity"),
            "status": incident_data.get("status"),
            "changes": changes,
        }
        
        await self._broadcast_event(tenant_id, event_type, payload)
        logger.info(f"Broadcasted incident.updated for {incident_id}")
    
    async def broadcast_incident_resolved(
        self,
        tenant_id: uuid.UUID,
        incident_id: uuid.UUID,
        incident_data: Dict[str, Any]
    ):
        """
        Broadcast incident.resolved event.
        
        Args:
            tenant_id: Tenant UUID
            incident_id: Incident UUID
            incident_data: Incident details
        
        Time complexity: O(n) where n is number of webhooks
        """
        event_type = "incident.resolved"
        payload = {
            "incident_id": str(incident_id),
            "title": incident_data.get("title"),
            "severity": incident_data.get("severity"),
            "resolved_at": incident_data.get("resolved_at"),
        }
        
        await self._broadcast_event(tenant_id, event_type, payload)
        logger.info(f"Broadcasted incident.resolved for {incident_id}")
    
    async def broadcast_deployment_created(
        self,
        tenant_id: uuid.UUID,
        deployment_id: uuid.UUID,
        deployment_data: Dict[str, Any]
    ):
        """
        Broadcast deployment.created event.
        
        Args:
            tenant_id: Tenant UUID
            deployment_id: Deployment UUID
            deployment_data: Deployment details
        
        Time complexity: O(n) where n is number of webhooks
        """
        event_type = "deployment.created"
        payload = {
            "deployment_id": str(deployment_id),
            "name": deployment_data.get("name"),
            "image": deployment_data.get("image"),
            "status": deployment_data.get("status"),
            "created_at": deployment_data.get("created_at"),
        }
        
        await self._broadcast_event(tenant_id, event_type, payload)
        logger.info(f"Broadcasted deployment.created for {deployment_id}")
    
    async def broadcast_deployment_status_changed(
        self,
        tenant_id: uuid.UUID,
        deployment_id: uuid.UUID,
        deployment_data: Dict[str, Any],
        old_status: str,
        new_status: str
    ):
        """
        Broadcast deployment status change event.
        
        Args:
            tenant_id: Tenant UUID
            deployment_id: Deployment UUID
            deployment_data: Deployment details
            old_status: Previous status
            new_status: New status
        
        Time complexity: O(n) where n is number of webhooks
        """
        # Determine specific event type
        if new_status == "failed":
            event_type = "deployment.failed"
        elif new_status == "running":
            event_type = "deployment.succeeded"
        else:
            event_type = "deployment.updated"
        
        payload = {
            "deployment_id": str(deployment_id),
            "name": deployment_data.get("name"),
            "image": deployment_data.get("image"),
            "old_status": old_status,
            "new_status": new_status,
            "updated_at": deployment_data.get("updated_at"),
        }
        
        await self._broadcast_event(tenant_id, event_type, payload)
        logger.info(f"Broadcasted {event_type} for {deployment_id}")
    
    async def broadcast_alert_triggered(
        self,
        tenant_id: uuid.UUID,
        alert_id: str,
        alert_data: Dict[str, Any]
    ):
        """
        Broadcast alert.triggered event.
        
        Args:
            tenant_id: Tenant UUID
            alert_id: Alert identifier
            alert_data: Alert details
        
        Time complexity: O(n) where n is number of webhooks
        """
        event_type = "alert.triggered"
        payload = {
            "alert_id": alert_id,
            "alert_name": alert_data.get("name"),
            "severity": alert_data.get("severity"),
            "message": alert_data.get("message"),
            "triggered_at": alert_data.get("triggered_at"),
        }
        
        await self._broadcast_event(tenant_id, event_type, payload)
        logger.info(f"Broadcasted alert.triggered for {alert_id}")
    
    async def _broadcast_event(
        self,
        tenant_id: uuid.UUID,
        event_type: str,
        payload: Dict[str, Any]
    ):
        """
        Broadcast event to all matching webhooks.
        
        Args:
            tenant_id: Tenant UUID
            event_type: Event type (e.g., "incident.created")
            payload: Event payload
        
        Time complexity: O(n) where n is number of webhooks
        """
        try:
            webhook_service = WebhookService(self.db)
            await webhook_service.broadcast_event(tenant_id, event_type, payload)
        except Exception as e:
            logger.error(f"Failed to broadcast event {event_type}: {e}")
            # Don't fail the main operation if webhook broadcast fails
    
    def broadcast_incident_created_sync(
        self,
        tenant_id: uuid.UUID,
        incident_id: uuid.UUID,
        incident_data: Dict[str, Any]
    ):
        """
        Synchronous wrapper for incident.created broadcast.
        
        Creates async task without blocking.
        
        Args:
            tenant_id: Tenant UUID
            incident_id: Incident UUID
            incident_data: Incident details
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Create task without awaiting
                asyncio.create_task(
                    self.broadcast_incident_created(tenant_id, incident_id, incident_data)
                )
            else:
                # Run in new event loop
                asyncio.run(
                    self.broadcast_incident_created(tenant_id, incident_id, incident_data)
                )
        except Exception as e:
            logger.error(f"Failed to create broadcast task: {e}")
    
    def broadcast_deployment_status_changed_sync(
        self,
        tenant_id: uuid.UUID,
        deployment_id: uuid.UUID,
        deployment_data: Dict[str, Any],
        old_status: str,
        new_status: str
    ):
        """
        Synchronous wrapper for deployment status change broadcast.
        
        Creates async task without blocking.
        
        Args:
            tenant_id: Tenant UUID
            deployment_id: Deployment UUID
            deployment_data: Deployment details
            old_status: Previous status
            new_status: New status
        """
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(
                    self.broadcast_deployment_status_changed(
                        tenant_id, deployment_id, deployment_data, old_status, new_status
                    )
                )
            else:
                asyncio.run(
                    self.broadcast_deployment_status_changed(
                        tenant_id, deployment_id, deployment_data, old_status, new_status
                    )
                )
        except Exception as e:
            logger.error(f"Failed to create broadcast task: {e}")

    def broadcast_incident_updated_sync(
        self,
        tenant_id: uuid.UUID,
        incident_id: uuid.UUID,
        incident_data: Dict[str, Any],
        changes: Dict[str, Any]
    ):
        """Synchronous wrapper for incident.updated broadcast."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(
                    self.broadcast_incident_updated(tenant_id, incident_id, incident_data, changes)
                )
            else:
                asyncio.run(
                    self.broadcast_incident_updated(tenant_id, incident_id, incident_data, changes)
                )
        except Exception as e:
            logger.error(f"Failed to create broadcast task: {e}")

    def broadcast_incident_resolved_sync(
        self,
        tenant_id: uuid.UUID,
        incident_id: uuid.UUID,
        incident_data: Dict[str, Any]
    ):
        """Synchronous wrapper for incident.resolved broadcast."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(
                    self.broadcast_incident_resolved(tenant_id, incident_id, incident_data)
                )
            else:
                asyncio.run(
                    self.broadcast_incident_resolved(tenant_id, incident_id, incident_data)
                )
        except Exception as e:
            logger.error(f"Failed to create broadcast task: {e}")

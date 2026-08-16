"""
Alert Dispatcher — Unified alert delivery for KAYO

Dispatches alerts through available channels when security events occur.
Channels:
  - WebSocket (real-time, tenant-scoped)
  - Webhook (HTTP POST to registered URLs)

This replaces the pattern of requiring a frontend/API interaction to trigger alerts.
The dispatcher can be called directly by:
  - Detection Engine (after incident creation)
  - Control Plane (after incident update)
  - Monitor Service (after degradation/downtime)
"""
import logging
import asyncio
from typing import Optional, Dict, Any
from datetime import datetime
import uuid

logger = logging.getLogger(__name__)


class AlertDispatcher:
    """
    Unified alert dispatcher.
    
    Usage:
        dispatcher = AlertDispatcher(ws_manager, db_session)
        await dispatcher.dispatch_incident_alert(tenant_id, incident_data)
    """

    def __init__(self, ws_manager=None, db_session_factory=None):
        self.ws_manager = ws_manager
        self.db_session_factory = db_session_factory

    async def dispatch_incident_created(
        self,
        tenant_id: str,
        incident_id: str,
        incident_data: Dict[str, Any],
    ):
        """
        Dispatch alert when a new incident is created by detection.
        
        This is the primary detection→alert path.
        """
        alert_payload = {
            "alert_id": str(uuid.uuid4()),
            "type": "incident.created",
            "incident_id": incident_id,
            "tenant_id": tenant_id,
            "severity": incident_data.get("severity"),
            "attack_pattern": incident_data.get("attack_pattern"),
            "mitre_technique": incident_data.get("mitre_technique"),
            "status": "new",
            "timestamp": datetime.utcnow().isoformat(),
        }

        # WebSocket delivery
        ws_delivered = await self._deliver_websocket(tenant_id, "incident.created", alert_payload)

        # Webhook delivery
        webhook_delivered = await self._deliver_webhooks(tenant_id, "incident.created", alert_payload)

        logger.info(
            f"Alert dispatched for incident {incident_id}: "
            f"ws={'delivered' if ws_delivered else 'no_clients'}, "
            f"webhook={'delivered' if webhook_delivered else 'none_configured'}"
        )

        return {"ws_delivered": ws_delivered, "webhook_delivered": webhook_delivered}

    async def dispatch_incident_updated(
        self,
        tenant_id: str,
        incident_id: str,
        incident_data: Dict[str, Any],
    ):
        """Dispatch alert when an incident is updated."""
        alert_payload = {
            "type": "incident.updated",
            "incident_id": incident_id,
            "tenant_id": tenant_id,
            "severity": incident_data.get("severity"),
            "status": incident_data.get("status"),
            "timestamp": datetime.utcnow().isoformat(),
        }

        await self._deliver_websocket(tenant_id, "incident.updated", alert_payload)
        await self._deliver_webhooks(tenant_id, "incident.updated", alert_payload)

    async def dispatch_monitoring_alert(
        self,
        tenant_id: str,
        alert_type: str,
        alert_data: Dict[str, Any],
    ):
        """Dispatch alert from monitoring (degradation/downtime)."""
        alert_payload = {
            "type": f"monitor.{alert_type}",
            "tenant_id": tenant_id,
            "severity": alert_data.get("severity", "high"),
            "message": alert_data.get("message"),
            "url": alert_data.get("url"),
            "timestamp": datetime.utcnow().isoformat(),
        }

        await self._deliver_websocket(tenant_id, f"monitor.{alert_type}", alert_payload)
        await self._deliver_webhooks(tenant_id, f"monitor.{alert_type}", alert_payload)

    async def _deliver_websocket(self, tenant_id: str, event_type: str, data: Dict) -> bool:
        """Deliver via WebSocket to connected clients."""
        if not self.ws_manager:
            return False
        try:
            await self.ws_manager.broadcast(tenant_id, event_type, data)
            return True
        except Exception as e:
            logger.warning(f"WebSocket delivery failed: {e}")
            return False

    async def _deliver_webhooks(self, tenant_id: str, event_type: str, data: Dict) -> bool:
        """Deliver via registered webhooks."""
        if not self.db_session_factory:
            return False

        try:
            from models.webhook import Webhook
            db = self.db_session_factory()
            try:
                webhooks = db.query(Webhook).filter(
                    Webhook.tenant_id == tenant_id,
                    Webhook.active == True,
                ).all()

                if not webhooks:
                    return False

                import httpx
                delivered = False
                for webhook in webhooks:
                    events = webhook.events or []
                    if events and event_type not in events and "*" not in events:
                        continue

                    try:
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            resp = await client.post(
                                webhook.url,
                                json={"event": event_type, "data": data},
                                headers={"Content-Type": "application/json",
                                         "X-KAYO-Event": event_type},
                            )
                            delivered = True
                            logger.info(f"Webhook delivered to {webhook.url}: {resp.status_code}")
                    except Exception as e:
                        logger.warning(f"Webhook delivery to {webhook.url} failed: {e}")

                return delivered
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Webhook dispatch error: {e}")
            return False

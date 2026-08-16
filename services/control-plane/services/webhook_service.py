import httpx
import hmac
import hashlib
import json
import logging
from typing import Dict, List, Optional
from datetime import datetime
import asyncio
from sqlalchemy.orm import Session
import uuid

from models.webhook import Webhook, WebhookDelivery

logger = logging.getLogger(__name__)


class WebhookService:
    """
    Manages webhook delivery for events.
    
    Architecture:
    - Async HTTP delivery with retries
    - Exponential backoff for failures
    - HMAC signature for security
    - Delivery tracking and logs
    
    Security:
    - HMAC-SHA256 signature verification
    - Configurable secret per webhook
    - Timeout enforcement
    
    Performance:
    - Async delivery (non-blocking)
    - Batch delivery support
    - Configurable retry strategy
    
    Time complexity: O(1) per webhook delivery
    """
    
    MAX_RETRIES = 3
    RETRY_DELAYS = [1, 5, 15]  # seconds
    TIMEOUT = 30  # seconds
    
    def __init__(self, db: Session):
        """
        Initialize webhook service.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
        self.client = httpx.AsyncClient(timeout=self.TIMEOUT)
    
    async def deliver_webhook(
        self,
        webhook_id: uuid.UUID,
        event_type: str,
        payload: Dict
    ) -> bool:
        """
        Deliver webhook with retry logic.
        
        Args:
            webhook_id: Webhook UUID
            event_type: Event type (incident.created, deployment.failed, etc.)
            payload: Event payload
        
        Returns:
            True if delivered successfully, False otherwise
        
        Security: HMAC signature included in headers
        Time complexity: O(1) + O(n) retries
        """
        webhook = self.db.query(Webhook).filter(
            Webhook.webhook_id == webhook_id,
            Webhook.is_active == True
        ).first()
        
        if not webhook:
            logger.warning(f"Webhook {webhook_id} not found or inactive")
            return False
        
        # Check if event type matches webhook filters
        if not self._matches_event_filter(event_type, webhook.event_types):
            logger.debug(f"Event {event_type} does not match webhook filters")
            return False
        
        # Create delivery record
        delivery = WebhookDelivery(
            webhook_id=webhook_id,
            event_type=event_type,
            payload=payload,
            status="pending"
        )
        self.db.add(delivery)
        self.db.commit()
        self.db.refresh(delivery)
        
        # Attempt delivery with retries
        for attempt in range(self.MAX_RETRIES):
            try:
                success = await self._send_webhook(
                    url=webhook.url,
                    secret=webhook.secret,
                    event_type=event_type,
                    payload=payload,
                    delivery_id=delivery.delivery_id
                )
                
                if success:
                    delivery.status = "delivered"
                    delivery.delivered_at = datetime.utcnow()
                    delivery.attempts = attempt + 1
                    self.db.commit()
                    
                    logger.info(f"Webhook {webhook_id} delivered successfully")
                    return True
                
                # Wait before retry
                if attempt < self.MAX_RETRIES - 1:
                    await asyncio.sleep(self.RETRY_DELAYS[attempt])
            
            except Exception as e:
                logger.error(f"Webhook delivery attempt {attempt + 1} failed: {e}")
                delivery.error_message = str(e)
                delivery.attempts = attempt + 1
                
                if attempt < self.MAX_RETRIES - 1:
                    await asyncio.sleep(self.RETRY_DELAYS[attempt])
        
        # All retries failed
        delivery.status = "failed"
        self.db.commit()
        
        logger.error(f"Webhook {webhook_id} delivery failed after {self.MAX_RETRIES} attempts")
        return False
    
    async def _send_webhook(
        self,
        url: str,
        secret: str,
        event_type: str,
        payload: Dict,
        delivery_id: uuid.UUID
    ) -> bool:
        """
        Send HTTP POST request to webhook URL.
        
        Args:
            url: Webhook URL
            secret: Webhook secret for HMAC
            event_type: Event type
            payload: Event payload
            delivery_id: Delivery UUID
        
        Returns:
            True if 2xx response, False otherwise
        
        Security: HMAC-SHA256 signature in X-Webhook-Signature header
        Time complexity: O(1)
        """
        # Prepare payload
        webhook_payload = {
            "event_type": event_type,
            "timestamp": datetime.utcnow().isoformat(),
            "delivery_id": str(delivery_id),
            "data": payload
        }
        
        payload_json = json.dumps(webhook_payload)
        
        # Generate HMAC signature
        signature = self._generate_signature(payload_json, secret)
        
        # Send request
        headers = {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature,
            "X-Webhook-Event": event_type,
            "X-Webhook-Delivery": str(delivery_id),
            "User-Agent": "KAYO-Webhook/1.0"
        }
        
        try:
            response = await self.client.post(
                url,
                content=payload_json,
                headers=headers
            )
            
            # Log response
            logger.info(
                f"Webhook response: {response.status_code} "
                f"for delivery {delivery_id}"
            )
            
            return 200 <= response.status_code < 300
        except Exception as e:
            logger.error(f"Webhook request failed: {e}")
            raise
    
    async def broadcast_event(
        self,
        tenant_id: uuid.UUID,
        event_type: str,
        payload: Dict
    ):
        """
        Broadcast event to all matching webhooks for tenant.
        
        Args:
            tenant_id: Tenant UUID
            event_type: Event type
            payload: Event payload
        
        Time complexity: O(n) where n is number of webhooks
        """
        webhooks = self.db.query(Webhook).filter(
            Webhook.tenant_id == tenant_id,
            Webhook.is_active == True
        ).all()
        
        # Deliver to all matching webhooks concurrently
        tasks = [
            self.deliver_webhook(webhook.webhook_id, event_type, payload)
            for webhook in webhooks
        ]
        
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
    
    @staticmethod
    def _generate_signature(payload: str, secret: str) -> str:
        """
        Generate HMAC-SHA256 signature for webhook payload.
        
        Args:
            payload: JSON payload string
            secret: Webhook secret
        
        Returns:
            Hex-encoded HMAC signature
        
        Security: HMAC-SHA256 prevents tampering
        Time complexity: O(n) where n is payload length
        """
        signature = hmac.new(
            secret.encode(),
            payload.encode(),
            hashlib.sha256
        ).hexdigest()
        
        return f"sha256={signature}"
    
    @staticmethod
    def verify_signature(payload: str, signature: str, secret: str) -> bool:
        """
        Verify webhook signature.
        
        Args:
            payload: JSON payload string
            signature: Signature from X-Webhook-Signature header
            secret: Webhook secret
        
        Returns:
            True if signature is valid, False otherwise
        
        Security: Constant-time comparison prevents timing attacks
        Time complexity: O(n) where n is payload length
        """
        expected_signature = WebhookService._generate_signature(payload, secret)
        return hmac.compare_digest(signature, expected_signature)
    
    @staticmethod
    def _matches_event_filter(event_type: str, event_types: List[str]) -> bool:
        """
        Check if event type matches webhook filters.
        
        Args:
            event_type: Event type (e.g., "incident.created")
            event_types: List of event type filters (supports wildcards)
        
        Returns:
            True if matches, False otherwise
        
        Examples:
            - "incident.*" matches "incident.created", "incident.updated"
            - "*" matches all events
        
        Time complexity: O(n) where n is number of filters
        """
        if "*" in event_types:
            return True
        
        for filter_type in event_types:
            if filter_type.endswith(".*"):
                prefix = filter_type[:-2]
                if event_type.startswith(prefix + "."):
                    return True
            elif event_type == filter_type:
                return True
        
        return False
    
    async def cleanup(self):
        """Cleanup HTTP client on shutdown"""
        await self.client.aclose()

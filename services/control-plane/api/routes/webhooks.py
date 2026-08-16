from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid
import logging
import secrets

from database import get_db
from models.webhook import Webhook, WebhookDelivery
from schemas.webhook import WebhookCreate, WebhookResponse, WebhookUpdate, WebhookDeliveryResponse
from services.auth import get_current_user, get_current_tenant_id
from models.user import User

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])
logger = logging.getLogger(__name__)


@router.post("/", response_model=WebhookResponse, status_code=status.HTTP_201_CREATED)
async def create_webhook(
    webhook_data: WebhookCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Create webhook for event notifications.
    
    Security:
    - Generates HMAC secret for signature verification
    - Tenant-scoped
    
    Time complexity: O(1)
    """
    # Generate HMAC secret
    secret = secrets.token_urlsafe(32)
    
    webhook = Webhook(
        tenant_id=tenant_id,
        name=webhook_data.name,
        url=str(webhook_data.url),
        secret=secret,
        event_types=webhook_data.event_types,
        description=webhook_data.description,
        headers=webhook_data.headers
    )
    
    db.add(webhook)
    db.commit()
    db.refresh(webhook)
    
    logger.info(f"Created webhook {webhook.webhook_id} for tenant {tenant_id}")
    
    return webhook


@router.get("/", response_model=List[WebhookResponse])
async def list_webhooks(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    List webhooks for current tenant.
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(n) where n is number of webhooks
    """
    webhooks = db.query(Webhook).filter(
        Webhook.tenant_id == tenant_id
    ).offset(skip).limit(limit).all()
    
    return webhooks


@router.get("/{webhook_id}", response_model=WebhookResponse)
async def get_webhook(
    webhook_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Get webhook details.
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(1)
    """
    webhook = db.query(Webhook).filter(
        Webhook.webhook_id == webhook_id,
        Webhook.tenant_id == tenant_id
    ).first()
    
    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webhook not found"
        )
    
    return webhook


@router.patch("/{webhook_id}", response_model=WebhookResponse)
async def update_webhook(
    webhook_id: uuid.UUID,
    webhook_update: WebhookUpdate,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Update webhook configuration.
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(1)
    """
    webhook = db.query(Webhook).filter(
        Webhook.webhook_id == webhook_id,
        Webhook.tenant_id == tenant_id
    ).first()
    
    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webhook not found"
        )
    
    # Update fields
    if webhook_update.name is not None:
        webhook.name = webhook_update.name
    if webhook_update.url is not None:
        webhook.url = str(webhook_update.url)
    if webhook_update.event_types is not None:
        webhook.event_types = webhook_update.event_types
    if webhook_update.description is not None:
        webhook.description = webhook_update.description
    if webhook_update.headers is not None:
        webhook.headers = webhook_update.headers
    if webhook_update.is_active is not None:
        webhook.is_active = webhook_update.is_active
    
    db.commit()
    db.refresh(webhook)
    
    logger.info(f"Updated webhook {webhook_id}")
    return webhook


@router.delete("/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(
    webhook_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Delete webhook.
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(1)
    """
    webhook = db.query(Webhook).filter(
        Webhook.webhook_id == webhook_id,
        Webhook.tenant_id == tenant_id
    ).first()
    
    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webhook not found"
        )
    
    db.delete(webhook)
    db.commit()
    
    logger.info(f"Deleted webhook {webhook_id}")


@router.get("/{webhook_id}/deliveries", response_model=List[WebhookDeliveryResponse])
async def list_webhook_deliveries(
    webhook_id: uuid.UUID,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    List delivery logs for webhook.
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(n) where n is number of deliveries
    """
    # Verify webhook belongs to tenant
    webhook = db.query(Webhook).filter(
        Webhook.webhook_id == webhook_id,
        Webhook.tenant_id == tenant_id
    ).first()
    
    if not webhook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Webhook not found"
        )
    
    deliveries = db.query(WebhookDelivery).filter(
        WebhookDelivery.webhook_id == webhook_id
    ).order_by(WebhookDelivery.created_at.desc()).offset(skip).limit(limit).all()
    
    return deliveries

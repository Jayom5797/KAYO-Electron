from pydantic import BaseModel, Field, HttpUrl, validator
from typing import Optional, List, Dict
from datetime import datetime
import uuid


class WebhookCreate(BaseModel):
    """Schema for creating webhook"""
    name: str = Field(..., min_length=1, max_length=255, description="Webhook name")
    url: HttpUrl = Field(..., description="Webhook URL")
    event_types: List[str] = Field(..., min_items=1, description="Event types to subscribe to")
    description: Optional[str] = Field(None, description="Webhook description")
    headers: Optional[Dict[str, str]] = Field(None, description="Custom headers")
    
    @validator('event_types')
    def validate_event_types(cls, v):
        """Validate event type patterns"""
        valid_prefixes = ['incident', 'deployment', 'alert', 'tenant', 'user']
        for event_type in v:
            if event_type == '*':
                continue
            if event_type.endswith('.*'):
                prefix = event_type[:-2]
                if prefix not in valid_prefixes:
                    raise ValueError(f'Invalid event type prefix: {prefix}')
            else:
                parts = event_type.split('.')
                if len(parts) != 2 or parts[0] not in valid_prefixes:
                    raise ValueError(f'Invalid event type: {event_type}')
        return v
    
    class Config:
        json_schema_extra = {
            "example": {
                "name": "Slack Incident Notifications",
                "url": "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX",
                "event_types": ["incident.created", "incident.updated"],
                "description": "Send incident notifications to #security-alerts channel"
            }
        }


class WebhookUpdate(BaseModel):
    """Schema for updating webhook"""
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    url: Optional[HttpUrl] = None
    event_types: Optional[List[str]] = Field(None, min_items=1)
    description: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    is_active: Optional[bool] = None
    
    @validator('event_types')
    def validate_event_types(cls, v):
        """Validate event type patterns"""
        if v is None:
            return v
        valid_prefixes = ['incident', 'deployment', 'alert', 'tenant', 'user']
        for event_type in v:
            if event_type == '*':
                continue
            if event_type.endswith('.*'):
                prefix = event_type[:-2]
                if prefix not in valid_prefixes:
                    raise ValueError(f'Invalid event type prefix: {prefix}')
            else:
                parts = event_type.split('.')
                if len(parts) != 2 or parts[0] not in valid_prefixes:
                    raise ValueError(f'Invalid event type: {event_type}')
        return v


class WebhookResponse(BaseModel):
    """Schema for webhook response"""
    webhook_id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    url: str
    event_types: List[str]
    is_active: bool
    description: Optional[str] = None
    headers: Optional[Dict[str, str]] = None
    created_at: datetime
    updated_at: datetime
    last_triggered_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "webhook_id": "550e8400-e29b-41d4-a716-446655440000",
                "tenant_id": "660e8400-e29b-41d4-a716-446655440000",
                "name": "Slack Incident Notifications",
                "url": "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX",
                "event_types": ["incident.created", "incident.updated"],
                "is_active": True,
                "description": "Send incident notifications to #security-alerts channel",
                "created_at": "2026-03-12T10:00:00Z",
                "updated_at": "2026-03-12T10:00:00Z",
                "last_triggered_at": "2026-03-12T12:30:00Z"
            }
        }


class WebhookDeliveryResponse(BaseModel):
    """Schema for webhook delivery response"""
    delivery_id: uuid.UUID
    webhook_id: uuid.UUID
    event_type: str
    status: str
    status_code: Optional[int] = None
    error_message: Optional[str] = None
    attempts: int
    created_at: datetime
    delivered_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "delivery_id": "770e8400-e29b-41d4-a716-446655440000",
                "webhook_id": "550e8400-e29b-41d4-a716-446655440000",
                "event_type": "incident.created",
                "status": "delivered",
                "status_code": 200,
                "error_message": None,
                "attempts": 1,
                "created_at": "2026-03-12T12:30:00Z",
                "delivered_at": "2026-03-12T12:30:01Z"
            }
        }

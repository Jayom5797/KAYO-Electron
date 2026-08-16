from pydantic import BaseModel
from typing import Optional, Dict, List, Any
from datetime import datetime
import uuid


class IncidentUpdate(BaseModel):
    """Schema for updating incident"""
    status: Optional[str] = None
    notes: Optional[List[Any]] = None


class IncidentResponse(BaseModel):
    """Schema for incident response"""
    incident_id: uuid.UUID
    tenant_id: uuid.UUID
    title: Optional[str] = None
    description: Optional[str] = None
    severity: str
    status: str
    attack_pattern: Optional[str] = None
    mitre_technique: Optional[str] = None
    root_event_id: Optional[uuid.UUID] = None
    event_chain: List[uuid.UUID] = []
    graph_snapshot: Dict = {}
    ai_summary: Optional[str] = None
    remediation_steps: List = []
    notes: List = []
    created_at: datetime
    updated_at: datetime
    resolved_at: Optional[datetime] = None

    class Config:
        from_attributes = True

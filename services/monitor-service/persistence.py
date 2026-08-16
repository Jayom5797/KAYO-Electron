"""
Monitor Persistence Layer

Stores monitoring data in PostgreSQL (reuses KAYO's existing database).
Replaces in-memory storage with durable persistence.

Tables used:
  - monitor_endpoints: registered endpoints + baselines
  - monitor_probes: probe history
"""
import os
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid
import psycopg2
from psycopg2.extras import RealDictCursor
import json

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://kayo:kayo_dev_password@localhost:5433/kayo_control_plane")


def get_connection():
    """Get PostgreSQL connection."""
    return psycopg2.connect(DATABASE_URL)


def init_tables():
    """Create monitor tables if they don't exist."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS monitor_endpoints (
            endpoint_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL,
            deployment_id UUID,
            asset_id UUID,
            url TEXT NOT NULL,
            interval_s INTEGER NOT NULL DEFAULT 30,
            baseline_latency_ms REAL,
            baseline_status INTEGER,
            status TEXT NOT NULL DEFAULT 'active',
            consecutive_failures INTEGER NOT NULL DEFAULT 0,
            last_probe_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        
        CREATE TABLE IF NOT EXISTS monitor_probes (
            probe_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            endpoint_id UUID NOT NULL REFERENCES monitor_endpoints(endpoint_id) ON DELETE CASCADE,
            tenant_id UUID NOT NULL,
            status_code INTEGER NOT NULL,
            latency_ms INTEGER NOT NULL,
            health TEXT NOT NULL,
            error TEXT,
            alert_type TEXT,
            alert_severity TEXT,
            alert_message TEXT,
            probed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_monitor_endpoints_tenant ON monitor_endpoints(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_monitor_probes_endpoint ON monitor_probes(endpoint_id);
        CREATE INDEX IF NOT EXISTS idx_monitor_probes_tenant ON monitor_probes(tenant_id);
    """)
    conn.commit()
    conn.close()
    logger.info("Monitor tables initialized")


def save_endpoint(endpoint_data: Dict[str, Any]) -> str:
    """Save a monitored endpoint."""
    conn = get_connection()
    cur = conn.cursor()
    endpoint_id = endpoint_data.get("endpoint_id", str(uuid.uuid4()))
    cur.execute("""
        INSERT INTO monitor_endpoints (endpoint_id, tenant_id, deployment_id, url, interval_s, 
                                       baseline_latency_ms, baseline_status, status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (endpoint_id) DO UPDATE SET
            baseline_latency_ms = EXCLUDED.baseline_latency_ms,
            baseline_status = EXCLUDED.baseline_status,
            status = EXCLUDED.status
    """, (
        endpoint_id,
        endpoint_data["tenant_id"],
        endpoint_data.get("deployment_id"),
        endpoint_data["url"],
        endpoint_data.get("interval_s", 30),
        endpoint_data.get("baseline_latency_ms"),
        endpoint_data.get("baseline_status"),
        endpoint_data.get("status", "active"),
    ))
    conn.commit()
    conn.close()
    return endpoint_id


def save_probe(endpoint_id: str, tenant_id: str, probe_data: Dict[str, Any]):
    """Save a probe result."""
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO monitor_probes (endpoint_id, tenant_id, status_code, latency_ms, health, 
                                    error, alert_type, alert_severity, alert_message)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        endpoint_id,
        tenant_id,
        probe_data["status_code"],
        probe_data["latency_ms"],
        probe_data["health"],
        probe_data.get("error"),
        probe_data.get("alert_type"),
        probe_data.get("alert_severity"),
        probe_data.get("alert_message"),
    ))
    # Update endpoint last_probe and consecutive_failures
    if probe_data["status_code"] == 0 or probe_data["status_code"] >= 500:
        cur.execute("UPDATE monitor_endpoints SET consecutive_failures = consecutive_failures + 1, last_probe_at = NOW() WHERE endpoint_id = %s", (endpoint_id,))
    else:
        cur.execute("UPDATE monitor_endpoints SET consecutive_failures = 0, last_probe_at = NOW() WHERE endpoint_id = %s", (endpoint_id,))
    conn.commit()
    conn.close()


def get_endpoints(tenant_id: Optional[str] = None) -> List[Dict]:
    """Get monitored endpoints."""
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    if tenant_id:
        cur.execute("SELECT * FROM monitor_endpoints WHERE tenant_id = %s ORDER BY created_at DESC", (tenant_id,))
    else:
        cur.execute("SELECT * FROM monitor_endpoints ORDER BY created_at DESC")
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_endpoint(endpoint_id: str) -> Optional[Dict]:
    """Get a single endpoint."""
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM monitor_endpoints WHERE endpoint_id = %s", (endpoint_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_probe_history(endpoint_id: str, limit: int = 100) -> List[Dict]:
    """Get probe history for an endpoint."""
    conn = get_connection()
    cur = conn.cursor(cursor_factory=RealDictCursor)
    cur.execute("SELECT * FROM monitor_probes WHERE endpoint_id = %s ORDER BY probed_at DESC LIMIT %s", (endpoint_id, limit))
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]

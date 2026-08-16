"""
KAYO Monitor Service — HTTP API

Provides uptime monitoring and resilience testing capabilities
as a service accessible from the control plane.
"""
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import uuid
import logging
from datetime import datetime

from uptime_monitor import probe, establish_baseline, evaluate_probe, MonitorBaseline, ProbeResult
from stress_tester import run_stress_test, StressResult

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="KAYO Monitor Service", version="1.0.0")

# ── In-memory state (production: use Redis/PostgreSQL) ─────────────────────────
monitored_endpoints: Dict[str, Dict[str, Any]] = {}
probe_history: Dict[str, List[Dict[str, Any]]] = {}
stress_results: Dict[str, Dict[str, Any]] = {}


# ── Auth middleware ────────────────────────────────────────────────────────────
import os
SERVICE_TOKEN = os.environ.get("KAYO_SERVICE_TOKEN", "kayo-internal-service-token")

from fastapi import Request

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    token = request.headers.get("x-kayo-service-token", "")
    if token != SERVICE_TOKEN:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    return await call_next(request)


# ── Schemas ────────────────────────────────────────────────────────────────────

class MonitorRequest(BaseModel):
    tenant_id: str
    deployment_id: Optional[str] = None
    url: str
    interval_s: int = Field(default=30, ge=10, le=300)


class StressRequest(BaseModel):
    tenant_id: str
    deployment_id: Optional[str] = None
    url: str
    concurrency: int = Field(default=20, ge=1, le=50)
    duration_s: int = Field(default=30, ge=5, le=120)
    authorized: bool = Field(default=False, description="Must be True to run stress test")


class ProbeResponse(BaseModel):
    url: str
    status_code: int
    latency_ms: int
    health: str
    baseline_latency_ms: Optional[float] = None
    alert: Optional[Dict[str, Any]] = None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "monitor-service", "version": "1.0.0"}


@app.post("/monitor/register")
async def register_endpoint(req: MonitorRequest):
    """Register a URL for continuous monitoring. Establishes baseline."""
    endpoint_id = str(uuid.uuid4())

    # Establish baseline
    baseline = establish_baseline(req.url, probe_count=3, timeout=8)
    if baseline is None:
        raise HTTPException(status_code=400, detail=f"Cannot reach {req.url}")

    monitored_endpoints[endpoint_id] = {
        "endpoint_id": endpoint_id,
        "tenant_id": req.tenant_id,
        "deployment_id": req.deployment_id,
        "url": req.url,
        "interval_s": req.interval_s,
        "baseline": {
            "avg_latency_ms": baseline.avg_latency_ms,
            "typical_status": baseline.typical_status,
        },
        "status": "active",
        "registered_at": datetime.utcnow().isoformat(),
        "consecutive_failures": 0,
    }

    probe_history[endpoint_id] = []

    logger.info(f"Registered endpoint {req.url} (baseline: {baseline.avg_latency_ms:.0f}ms)")

    return {
        "endpoint_id": endpoint_id,
        "baseline": monitored_endpoints[endpoint_id]["baseline"],
        "status": "active",
    }


@app.post("/monitor/probe/{endpoint_id}", response_model=ProbeResponse)
async def run_probe(endpoint_id: str):
    """Run a single probe against a registered endpoint."""
    endpoint = monitored_endpoints.get(endpoint_id)
    if not endpoint:
        raise HTTPException(status_code=404, detail="Endpoint not registered")

    result = probe(endpoint["url"], timeout=8)

    # Evaluate against baseline
    baseline = MonitorBaseline(
        url=endpoint["url"],
        avg_latency_ms=endpoint["baseline"]["avg_latency_ms"],
        typical_status=endpoint["baseline"]["typical_status"],
    )

    if not result.is_healthy:
        endpoint["consecutive_failures"] += 1
    else:
        endpoint["consecutive_failures"] = 0

    alert_obj = evaluate_probe(result, baseline, endpoint["consecutive_failures"])

    # Store in history
    probe_record = {
        "status_code": result.status_code,
        "latency_ms": result.latency_ms,
        "health": "healthy" if result.is_healthy else "down",
        "timestamp": datetime.utcnow().isoformat(),
        "alert": {"type": alert_obj.type, "severity": alert_obj.severity, "message": alert_obj.message} if alert_obj else None,
    }
    probe_history.setdefault(endpoint_id, []).append(probe_record)
    # Keep last 100 probes
    probe_history[endpoint_id] = probe_history[endpoint_id][-100:]

    health = "healthy"
    if result.status_code == 0 or result.status_code >= 500:
        health = "down"
    elif result.latency_ms > baseline.avg_latency_ms * 3:
        health = "degraded"

    return ProbeResponse(
        url=endpoint["url"],
        status_code=result.status_code,
        latency_ms=result.latency_ms,
        health=health,
        baseline_latency_ms=baseline.avg_latency_ms,
        alert=probe_record["alert"],
    )


@app.get("/monitor/endpoints")
async def list_endpoints(tenant_id: Optional[str] = None):
    """List all registered endpoints."""
    endpoints = list(monitored_endpoints.values())
    if tenant_id:
        endpoints = [e for e in endpoints if e["tenant_id"] == tenant_id]
    return {"endpoints": endpoints}


@app.get("/monitor/history/{endpoint_id}")
async def get_probe_history(endpoint_id: str):
    """Get probe history for an endpoint."""
    if endpoint_id not in monitored_endpoints:
        raise HTTPException(status_code=404, detail="Endpoint not found")
    return {"endpoint_id": endpoint_id, "probes": probe_history.get(endpoint_id, [])}


@app.post("/stress/run")
async def run_stress(req: StressRequest, background_tasks: BackgroundTasks):
    """
    Run a stress/resilience test. Requires explicit authorization.
    """
    if not req.authorized:
        raise HTTPException(
            status_code=403,
            detail="Stress testing requires explicit authorization (set authorized=true). "
                   "Only test targets you own or are authorized to test."
        )

    test_id = str(uuid.uuid4())
    stress_results[test_id] = {"status": "running", "started_at": datetime.utcnow().isoformat()}

    def _run():
        result = run_stress_test(
            url=req.url,
            concurrency=req.concurrency,
            duration=req.duration_s,
        )
        stress_results[test_id] = {
            "status": "completed",
            "test_id": test_id,
            "tenant_id": req.tenant_id,
            "deployment_id": req.deployment_id,
            "url": req.url,
            "result": {
                "total_requests": result.total_requests,
                "rps_avg": result.rps_avg,
                "success_rate_pct": result.success_rate_pct,
                "error_count": result.error_count,
                "latency_avg_ms": result.latency_avg_ms,
                "latency_p95_ms": result.latency_p95_ms,
                "latency_p99_ms": result.latency_p99_ms,
                "verdict": result.verdict,
                "breaking_point": result.breaking_point,
            },
            "completed_at": datetime.utcnow().isoformat(),
        }

    background_tasks.add_task(_run)

    return {"test_id": test_id, "status": "running"}


@app.get("/stress/{test_id}")
async def get_stress_result(test_id: str):
    """Get stress test result."""
    result = stress_results.get(test_id)
    if not result:
        raise HTTPException(status_code=404, detail="Test not found")
    return result


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8002))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)

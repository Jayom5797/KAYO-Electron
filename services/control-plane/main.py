from fastapi import FastAPI, Request, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import logging
import time
import asyncio
from typing import Dict, Set

from config import settings
from database import engine, Base, SessionLocal
from api.routes import tenants_router, auth_router, deployments_router, incidents_router, invitations_router, webhooks_router, audit_logs_router, compliance_router, scans_router, projects_router
from api.middleware.rate_limiter import RateLimitMiddleware
from api.middleware.audit_logger import AuditLogMiddleware

# Configure logging
logging.basicConfig(
    level=logging.INFO if settings.debug else logging.WARNING,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------
class ConnectionManager:
    """Manages active WebSocket connections per tenant."""

    def __init__(self):
        # tenant_id -> set of websockets
        self._connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, tenant_id: str):
        await websocket.accept()
        self._connections.setdefault(tenant_id, set()).add(websocket)
        logger.info(f"WS connected: tenant={tenant_id}, total={len(self._connections[tenant_id])}")

    def disconnect(self, websocket: WebSocket, tenant_id: str):
        conns = self._connections.get(tenant_id, set())
        conns.discard(websocket)
        if not conns:
            self._connections.pop(tenant_id, None)

    async def broadcast(self, tenant_id: str, event_type: str, data: dict):
        """Send event to all connections for a tenant."""
        message = {"type": event_type, "data": data}
        dead = set()
        for ws in list(self._connections.get(tenant_id, set())):
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.disconnect(ws, tenant_id)

    async def broadcast_all(self, event_type: str, data: dict):
        """Broadcast to every connected tenant (admin use)."""
        for tenant_id in list(self._connections.keys()):
            await self.broadcast(tenant_id, event_type, data)


ws_manager = ConnectionManager()

# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    debug=settings.debug,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rate limiting middleware
app.add_middleware(
    RateLimitMiddleware,
    redis_url=settings.redis_url
)

# Audit logging middleware
app.add_middleware(
    AuditLogMiddleware,
    db_session_factory=SessionLocal
)


# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """
    Log all HTTP requests with timing information.
    
    Performance: Adds minimal overhead (<1ms per request)
    """
    start_time = time.time()
    
    response = await call_next(request)
    
    process_time = time.time() - start_time
    logger.info(
        f"{request.method} {request.url.path} "
        f"completed in {process_time:.3f}s with status {response.status_code}"
    )
    
    response.headers["X-Process-Time"] = str(process_time)
    return response


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Handle uncaught exceptions gracefully.
    
    Security: Avoids leaking internal error details in production
    """
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    
    if settings.debug:
        detail = str(exc)
    else:
        detail = "Internal server error"
    
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": detail}
    )


# Health check endpoint
@app.get("/health")
async def health_check():
    """
    Extended health check — checks all service dependencies.
    Returns status of API, PostgreSQL, Redis, Kafka, Neo4j, ClickHouse.
    """
    import time as _time
    from sqlalchemy import text

    checks = {}
    overall = "healthy"

    # PostgreSQL
    try:
        start = _time.time()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["postgresql"] = {"status": "up", "response_ms": round((_time.time() - start) * 1000)}
    except Exception as e:
        checks["postgresql"] = {"status": "down", "error": str(e)}
        overall = "degraded"

    # Redis
    try:
        import redis as redis_lib
        start = _time.time()
        r = redis_lib.from_url(settings.redis_url, socket_connect_timeout=2)
        r.ping()
        checks["redis"] = {"status": "up", "response_ms": round((_time.time() - start) * 1000)}
    except Exception as e:
        checks["redis"] = {"status": "down", "error": str(e)}
        overall = "degraded"

    # Kafka
    try:
        import socket
        start = _time.time()
        host, port = settings.kafka_bootstrap_servers.split(",")[0].split(":")
        sock = socket.create_connection((host, int(port)), timeout=2)
        sock.close()
        checks["kafka"] = {"status": "up", "response_ms": round((_time.time() - start) * 1000)}
    except Exception as e:
        checks["kafka"] = {"status": "down", "error": str(e)}
        overall = "degraded"

    # Neo4j
    try:
        from neo4j import GraphDatabase
        start = _time.time()
        driver = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password),
            connection_timeout=2
        )
        driver.verify_connectivity()
        driver.close()
        checks["neo4j"] = {"status": "up", "response_ms": round((_time.time() - start) * 1000)}
    except Exception as e:
        checks["neo4j"] = {"status": "down", "error": str(e)}
        overall = "degraded"

    # ClickHouse
    try:
        import socket
        start = _time.time()
        sock = socket.create_connection((settings.clickhouse_host, settings.clickhouse_port), timeout=2)
        sock.close()
        checks["clickhouse"] = {"status": "up", "response_ms": round((_time.time() - start) * 1000)}
    except Exception as e:
        checks["clickhouse"] = {"status": "down", "error": str(e)}
        overall = "degraded"

    return {
        "status": overall,
        "version": settings.app_version,
        "service": "control-plane",
        "dependencies": checks,
    }


# Include routers
app.include_router(auth_router)
app.include_router(tenants_router)
app.include_router(deployments_router)
app.include_router(incidents_router)
app.include_router(invitations_router)
app.include_router(webhooks_router)
app.include_router(audit_logs_router)
app.include_router(compliance_router)
app.include_router(scans_router)
app.include_router(projects_router)


# WebSocket endpoint — authenticated via token query param
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = None):
    """
    Real-time event stream per tenant.

    Connect: ws://localhost:8000/ws?token=<jwt>
    Events pushed: incident.created, incident.updated, deployment.status_changed
    """
    from services.auth import get_current_user
    from database import SessionLocal as _SessionLocal
    from jose import JWTError, jwt as _jwt
    import uuid as _uuid

    # Authenticate via token query param
    if not token:
        await websocket.close(code=4001)
        return

    try:
        payload = _jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        tenant_id: str = payload.get("tenant_id")
        if not tenant_id:
            await websocket.close(code=4001)
            return
    except JWTError:
        await websocket.close(code=4001)
        return

    await ws_manager.connect(websocket, tenant_id)
    try:
        while True:
            # Keep connection alive; client can send pings
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                # Send heartbeat
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        ws_manager.disconnect(websocket, tenant_id)
        logger.info(f"WS disconnected: tenant={tenant_id}")


# Startup event
@app.on_event("startup")
async def startup_event():
    """
    Initialize application on startup.
    
    Creates database tables if they don't exist.
    """
    logger.info(f"Starting {settings.app_name} v{settings.app_version}")
    
    # Create database tables
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created successfully")
    except Exception as e:
        logger.error(f"Failed to create database tables: {e}")
        raise


# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown"""
    logger.info("Shutting down application")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.debug,
        log_level="info" if settings.debug else "warning"
    )

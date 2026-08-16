from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Response
import time
from functools import wraps
import logging

logger = logging.getLogger(__name__)

# HTTP Metrics
http_requests_total = Counter(
    'kayo_http_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status']
)

http_request_duration_seconds = Histogram(
    'kayo_http_request_duration_seconds',
    'HTTP request latency',
    ['method', 'endpoint']
)

# Authentication Metrics
auth_attempts_total = Counter(
    'kayo_auth_attempts_total',
    'Total authentication attempts',
    ['status']
)

# Tenant Metrics
tenants_total = Gauge(
    'kayo_tenants_total',
    'Total number of tenants'
)

tenant_provisioning_duration_seconds = Histogram(
    'kayo_tenant_provisioning_duration_seconds',
    'Tenant provisioning duration'
)

# Deployment Metrics
deployments_total = Counter(
    'kayo_deployments_total',
    'Total deployments',
    ['status', 'tenant_id']
)

deployment_duration_seconds = Histogram(
    'kayo_deployment_duration_seconds',
    'Deployment duration',
    ['tenant_id']
)

# Incident Metrics
incidents_total = Counter(
    'kayo_incidents_total',
    'Total incidents created',
    ['severity', 'tenant_id']
)

incidents_by_mitre_technique = Counter(
    'kayo_incidents_by_mitre_technique',
    'Incidents by MITRE ATT&CK technique',
    ['technique', 'tenant_id']
)

# Database Metrics
db_connections_active = Gauge(
    'kayo_db_connections_active',
    'Active database connections'
)

db_query_duration_seconds = Histogram(
    'kayo_db_query_duration_seconds',
    'Database query duration',
    ['operation']
)


def track_request_metrics(func):
    """
    Decorator to track HTTP request metrics.
    
    Tracks:
    - Request count by method, endpoint, status
    - Request duration by method, endpoint
    
    Time complexity: O(1) - metric recording
    """
    @wraps(func)
    async def wrapper(*args, **kwargs):
        start_time = time.time()
        
        try:
            response = await func(*args, **kwargs)
            status = response.status_code if hasattr(response, 'status_code') else 200
            
            # Record metrics
            http_requests_total.labels(
                method=kwargs.get('method', 'unknown'),
                endpoint=func.__name__,
                status=status
            ).inc()
            
            duration = time.time() - start_time
            http_request_duration_seconds.labels(
                method=kwargs.get('method', 'unknown'),
                endpoint=func.__name__
            ).observe(duration)
            
            return response
        
        except Exception as e:
            http_requests_total.labels(
                method=kwargs.get('method', 'unknown'),
                endpoint=func.__name__,
                status=500
            ).inc()
            raise
    
    return wrapper


def metrics_endpoint():
    """
    Prometheus metrics endpoint.
    
    Returns:
        Response with Prometheus metrics in text format
    
    Time complexity: O(n) where n is number of metrics
    """
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )

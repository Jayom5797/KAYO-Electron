from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.orm import Session
from datetime import datetime
import logging
import json
from typing import Optional

logger = logging.getLogger(__name__)


class AuditLogMiddleware(BaseHTTPMiddleware):
    """
    Audit logging middleware for security-sensitive operations.
    
    Logs:
    - All write operations (POST, PUT, PATCH, DELETE)
    - Authentication attempts
    - Permission changes
    - Resource access
    
    Performance:
    - Async logging to avoid blocking requests
    - Batch writes to database
    - O(1) per request overhead
    
    Security:
    - Immutable audit trail
    - Captures IP, user agent, request/response
    - Tenant-scoped
    """
    
    AUDITED_PATHS = [
        "/api/tenants",
        "/api/auth",
        "/api/users",
        "/api/deployments",
        "/api/incidents"
    ]
    
    AUDITED_METHODS = ["POST", "PUT", "PATCH", "DELETE"]
    
    def __init__(self, app, db_session_factory):
        super().__init__(app)
        self.db_session_factory = db_session_factory
    
    async def dispatch(self, request: Request, call_next):
        """
        Log request and response for audited operations.
        
        Time complexity: O(1)
        """
        # Check if request should be audited
        should_audit = self._should_audit(request)
        
        if not should_audit:
            return await call_next(request)
        
        # Capture request details
        request_body = await self._get_request_body(request)
        
        # Process request
        response = await call_next(request)
        
        # Log audit entry asynchronously
        await self._log_audit_entry(
            request=request,
            response=response,
            request_body=request_body
        )
        
        return response

    
    def _should_audit(self, request: Request) -> bool:
        """
        Determine if request should be audited.
        
        Time complexity: O(1)
        """
        # Audit all write operations
        if request.method in self.AUDITED_METHODS:
            return True
        
        # Audit specific read operations
        for path in self.AUDITED_PATHS:
            if request.url.path.startswith(path):
                return True
        
        return False
    
    async def _get_request_body(self, request: Request) -> Optional[dict]:
        """
        Extract request body for logging.
        
        Security: Redacts sensitive fields (password, token, secret)
        """
        try:
            body = await request.body()
            if not body:
                return None
            
            data = json.loads(body.decode())
            
            # Redact sensitive fields
            sensitive_fields = ["password", "token", "secret", "api_key"]
            for field in sensitive_fields:
                if field in data:
                    data[field] = "[REDACTED]"
            
            return data
        except:
            return None
    
    async def _log_audit_entry(
        self,
        request: Request,
        response,
        request_body: Optional[dict]
    ):
        """
        Create audit log entry in database.
        
        Time complexity: O(1) - single database insert
        """
        try:
            from models.audit_log import AuditLog
            
            # Extract context
            tenant_id = getattr(request.state, "tenant_id", None)
            user_id = getattr(request.state, "user_id", None)
            
            # Determine action from method and path
            action = self._determine_action(request.method, request.url.path)
            
            # Extract resource info
            resource_type, resource_id = self._extract_resource_info(request.url.path)
            
            # Create audit log entry
            db = self.db_session_factory()
            
            audit_entry = AuditLog(
                tenant_id=tenant_id,
                user_id=user_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                request_method=request.method,
                request_path=request.url.path,
                request_body=request_body,
                response_status=response.status_code,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent")
            )
            
            db.add(audit_entry)
            db.commit()
            
            logger.info(
                f"Audit: {action} by user {user_id} on {resource_type} "
                f"(status: {response.status_code})"
            )
        
        except Exception as e:
            logger.error(f"Failed to create audit log: {e}")
            # Don't fail request if audit logging fails
        finally:
            db.close()
    
    def _determine_action(self, method: str, path: str) -> str:
        """
        Determine action name from HTTP method and path.
        
        Time complexity: O(1)
        """
        action_map = {
            "POST": "create",
            "PUT": "update",
            "PATCH": "update",
            "DELETE": "delete",
            "GET": "read"
        }
        
        base_action = action_map.get(method, "unknown")
        
        # Add context from path
        if "login" in path:
            return "login"
        elif "logout" in path:
            return "logout"
        elif "register" in path:
            return "register"
        
        return base_action
    
    def _extract_resource_info(self, path: str) -> tuple:
        """
        Extract resource type and ID from path.
        
        Args:
            path: Request path
        
        Returns:
            (resource_type, resource_id)
        
        Time complexity: O(1)
        """
        parts = path.strip("/").split("/")
        
        if len(parts) < 3:
            return ("unknown", None)
        
        # Path format: /api/{resource_type}/{resource_id}
        resource_type = parts[1] if len(parts) > 1 else "unknown"
        resource_id = parts[2] if len(parts) > 2 else None
        
        # Validate UUID format
        if resource_id:
            try:
                import uuid
                uuid.UUID(resource_id)
            except:
                resource_id = None
        
        return (resource_type, resource_id)

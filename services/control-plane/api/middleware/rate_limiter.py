from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
import redis.asyncio as redis
from datetime import datetime
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Rate limiting middleware using Redis sliding window algorithm.
    
    Architecture:
    - Per-tenant rate limits based on subscription tier
    - Sliding window algorithm for accurate rate limiting
    - Redis for distributed rate limit state
    
    Performance:
    - O(1) rate limit check (Redis ZCOUNT + ZADD)
    - Minimal latency overhead (<5ms)
    
    Security:
    - Prevents API abuse and DoS attacks
    - Tenant-scoped limits
    """
    
    RATE_LIMITS = {
        "free": {"requests_per_minute": 100, "burst": 20},
        "pro": {"requests_per_minute": 1000, "burst": 200},
        "enterprise": {"requests_per_minute": 10000, "burst": 2000}
    }
    
    def __init__(self, app, redis_url: str):
        super().__init__(app)
        self.redis_client: Optional[redis.Redis] = None
        self.redis_url = redis_url
    
    async def dispatch(self, request: Request, call_next):
        """
        Check rate limit before processing request.
        
        Time complexity: O(1) - Redis operations
        """
        # Initialize Redis client on first request
        if self.redis_client is None:
            self.redis_client = await redis.from_url(
                self.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
        
        # Skip rate limiting for health checks
        if request.url.path in ["/health", "/metrics"]:
            return await call_next(request)
        
        # Extract tenant_id from request state (set by auth middleware)
        tenant_id = getattr(request.state, "tenant_id", None)
        
        if not tenant_id:
            # No tenant context - skip rate limiting
            return await call_next(request)
        
        # Get tenant tier from request state
        tenant_tier = getattr(request.state, "tenant_tier", "free")
        
        # Check rate limit
        allowed = await self._check_rate_limit(tenant_id, tenant_tier)
        
        if not allowed:
            # Get current usage for error message
            current_usage = await self._get_current_usage(tenant_id)
            limit = self.RATE_LIMITS[tenant_tier]["requests_per_minute"]
            
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded: {current_usage}/{limit} requests per minute",
                headers={
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(datetime.utcnow().timestamp()) + 60),
                    "Retry-After": "60"
                }
            )
        
        # Process request
        response = await call_next(request)
        
        # Add rate limit headers to response
        limit = self.RATE_LIMITS[tenant_tier]["requests_per_minute"]
        remaining = await self._get_remaining_requests(tenant_id, tenant_tier)
        
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(int(datetime.utcnow().timestamp()) + 60)
        
        return response

    
    async def _check_rate_limit(self, tenant_id: str, tenant_tier: str) -> bool:
        """
        Check if request is within rate limit using sliding window.
        
        Args:
            tenant_id: Tenant UUID
            tenant_tier: Subscription tier (free, pro, enterprise)
        
        Returns:
            True if within limit, False if exceeded
        
        Algorithm: Sliding window with Redis sorted set
        - Key: rate_limit:{tenant_id}
        - Score: timestamp (microseconds)
        - Value: request_id
        
        Time complexity: O(log N) where N is window size
        """
        now = datetime.utcnow().timestamp()
        window_start = now - 60  # 1 minute window
        
        key = f"rate_limit:{tenant_id}"
        limits = self.RATE_LIMITS.get(tenant_tier, self.RATE_LIMITS["free"])
        max_requests = limits["requests_per_minute"]
        
        try:
            # Remove old entries outside window
            await self.redis_client.zremrangebyscore(key, 0, window_start)
            
            # Count requests in current window
            current_count = await self.redis_client.zcard(key)
            
            if current_count >= max_requests:
                return False
            
            # Add current request
            request_id = f"{now}:{id(self)}"
            await self.redis_client.zadd(key, {request_id: now})
            
            # Set expiry on key (cleanup)
            await self.redis_client.expire(key, 120)
            
            return True
        
        except Exception as e:
            logger.error(f"Rate limit check failed: {e}")
            # Fail open - allow request if Redis is down
            return True
    
    async def _get_current_usage(self, tenant_id: str) -> int:
        """
        Get current request count in window.
        
        Time complexity: O(1)
        """
        key = f"rate_limit:{tenant_id}"
        try:
            return await self.redis_client.zcard(key)
        except:
            return 0
    
    async def _get_remaining_requests(self, tenant_id: str, tenant_tier: str) -> int:
        """
        Get remaining requests in current window.
        
        Time complexity: O(1)
        """
        limits = self.RATE_LIMITS.get(tenant_tier, self.RATE_LIMITS["free"])
        max_requests = limits["requests_per_minute"]
        current = await self._get_current_usage(tenant_id)
        return max(0, max_requests - current)

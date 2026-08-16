import pytest
from unittest.mock import Mock, patch
from datetime import datetime
from services.control_plane.api.middleware.rate_limiter import RateLimiter


@pytest.fixture
def mock_redis():
    """Mock Redis client"""
    with patch('redis.Redis') as mock:
        redis_instance = Mock()
        mock.return_value = redis_instance
        yield redis_instance


@pytest.fixture
def rate_limiter(mock_redis):
    """Create RateLimiter instance with mocked Redis"""
    return RateLimiter(
        redis_host='localhost',
        redis_port=6379,
        redis_db=0
    )


def test_check_rate_limit_within_limit(rate_limiter, mock_redis):
    """Test rate limit check when within limit"""
    mock_redis.zcard.return_value = 50
    mock_redis.pipeline.return_value.__enter__.return_value = Mock()
    
    tenant_id = 'test-tenant'
    tier = 'pro'
    
    allowed, remaining, reset_time = rate_limiter.check_rate_limit(tenant_id, tier)
    
    assert allowed is True
    assert remaining == 950  # 1000 - 50
    assert isinstance(reset_time, int)


def test_check_rate_limit_exceeded(rate_limiter, mock_redis):
    """Test rate limit check when limit exceeded"""
    mock_redis.zcard.return_value = 1001
    
    tenant_id = 'test-tenant'
    tier = 'pro'
    
    allowed, remaining, reset_time = rate_limiter.check_rate_limit(tenant_id, tier)
    
    assert allowed is False
    assert remaining == 0
    assert isinstance(reset_time, int)


def test_check_rate_limit_free_tier(rate_limiter, mock_redis):
    """Test rate limit for free tier"""
    mock_redis.zcard.return_value = 50
    mock_redis.pipeline.return_value.__enter__.return_value = Mock()
    
    tenant_id = 'test-tenant'
    tier = 'free'
    
    allowed, remaining, reset_time = rate_limiter.check_rate_limit(tenant_id, tier)
    
    assert allowed is True
    assert remaining == 50  # 100 - 50


def test_check_rate_limit_enterprise_tier(rate_limiter, mock_redis):
    """Test rate limit for enterprise tier"""
    mock_redis.zcard.return_value = 5000
    mock_redis.pipeline.return_value.__enter__.return_value = Mock()
    
    tenant_id = 'test-tenant'
    tier = 'enterprise'
    
    allowed, remaining, reset_time = rate_limiter.check_rate_limit(tenant_id, tier)
    
    assert allowed is True
    assert remaining == 5000  # 10000 - 5000


def test_check_rate_limit_redis_failure(rate_limiter, mock_redis):
    """Test graceful degradation when Redis fails"""
    mock_redis.zcard.side_effect = Exception('Redis connection failed')
    
    tenant_id = 'test-tenant'
    tier = 'pro'
    
    allowed, remaining, reset_time = rate_limiter.check_rate_limit(tenant_id, tier)
    
    # Should fail open (allow request)
    assert allowed is True
    assert remaining == 1000
    assert isinstance(reset_time, int)


def test_sliding_window_cleanup(rate_limiter, mock_redis):
    """Test that old entries are removed from sliding window"""
    mock_redis.zcard.return_value = 50
    pipeline_mock = Mock()
    mock_redis.pipeline.return_value.__enter__.return_value = pipeline_mock
    
    tenant_id = 'test-tenant'
    tier = 'pro'
    
    rate_limiter.check_rate_limit(tenant_id, tier)
    
    # Verify zremrangebyscore was called to remove old entries
    pipeline_mock.zremrangebyscore.assert_called_once()


def test_rate_limit_key_format(rate_limiter):
    """Test rate limit key format"""
    tenant_id = 'test-tenant-123'
    expected_key = 'rate_limit:test-tenant-123'
    
    key = rate_limiter._get_key(tenant_id)
    
    assert key == expected_key


def test_concurrent_requests(rate_limiter, mock_redis):
    """Test multiple concurrent requests"""
    mock_redis.zcard.return_value = 50
    mock_redis.pipeline.return_value.__enter__.return_value = Mock()
    
    tenant_id = 'test-tenant'
    tier = 'pro'
    
    # Simulate 10 concurrent requests
    results = []
    for _ in range(10):
        allowed, remaining, reset_time = rate_limiter.check_rate_limit(tenant_id, tier)
        results.append(allowed)
    
    # All should be allowed (within limit)
    assert all(results)

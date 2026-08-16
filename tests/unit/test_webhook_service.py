import pytest
from unittest.mock import Mock, AsyncMock, patch
import uuid
from datetime import datetime
from services.control_plane.services.webhook_service import WebhookService
from services.control_plane.models.webhook import Webhook, WebhookDelivery


@pytest.fixture
def mock_db():
    return Mock()


@pytest.fixture
def webhook_service(mock_db):
    return WebhookService(mock_db)


@pytest.fixture
def sample_webhook():
    return Webhook(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        url='https://example.com/webhook',
        event_types=['incident.created', 'deployment.failed'],
        secret='test_secret',
        is_active=True
    )


@pytest.mark.asyncio
async def test_deliver_webhook_success(webhook_service, sample_webhook, mock_db):
    """Test successful webhook delivery"""
    with patch('aiohttp.ClientSession.post') as mock_post:
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.text = AsyncMock(return_value='OK')
        mock_post.return_value.__aenter__.return_value = mock_response
        
        payload = {'incident_id': str(uuid.uuid4()), 'severity': 'high'}
        
        success = await webhook_service.deliver_webhook(
            sample_webhook,
            'incident.created',
            payload
        )
        
        assert success is True
        mock_db.add.assert_called_once()


@pytest.mark.asyncio
async def test_deliver_webhook_failure(webhook_service, sample_webhook, mock_db):
    """Test webhook delivery failure"""
    with patch('aiohttp.ClientSession.post') as mock_post:
        mock_response = AsyncMock()
        mock_response.status = 500
        mock_response.text = AsyncMock(return_value='Internal Server Error')
        mock_post.return_value.__aenter__.return_value = mock_response
        
        payload = {'test': 'data'}
        
        success = await webhook_service.deliver_webhook(
            sample_webhook,
            'incident.created',
            payload
        )
        
        assert success is False


@pytest.mark.asyncio
async def test_deliver_webhook_with_retry(webhook_service, sample_webhook, mock_db):
    """Test webhook retry logic"""
    with patch('aiohttp.ClientSession.post') as mock_post:
        mock_response = AsyncMock()
        mock_response.status = 503
        mock_response.text = AsyncMock(return_value='Service Unavailable')
        mock_post.return_value.__aenter__.return_value = mock_response
        
        payload = {'test': 'data'}
        
        success = await webhook_service.deliver_webhook(
            sample_webhook,
            'incident.created',
            payload,
            max_retries=3
        )
        
        assert success is False
        assert mock_post.call_count == 3


def test_generate_signature(webhook_service):
    """Test HMAC signature generation"""
    secret = 'test_secret'
    payload = '{"test": "data"}'
    
    signature = webhook_service._generate_signature(secret, payload)
    
    assert signature.startswith('sha256=')
    assert len(signature) > 7


def test_event_type_matches_wildcard(webhook_service):
    """Test event type matching with wildcards"""
    assert webhook_service._event_matches(['incident.*'], 'incident.created')
    assert webhook_service._event_matches(['incident.*'], 'incident.updated')
    assert not webhook_service._event_matches(['incident.*'], 'deployment.created')
    assert webhook_service._event_matches(['*'], 'any.event')


def test_event_type_matches_exact(webhook_service):
    """Test exact event type matching"""
    assert webhook_service._event_matches(['incident.created'], 'incident.created')
    assert not webhook_service._event_matches(['incident.created'], 'incident.updated')


@pytest.mark.asyncio
async def test_broadcast_event(webhook_service, mock_db):
    """Test broadcasting event to multiple webhooks"""
    tenant_id = uuid.uuid4()
    
    webhooks = [
        Webhook(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            url='https://example1.com/webhook',
            event_types=['incident.*'],
            secret='secret1',
            is_active=True
        ),
        Webhook(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            url='https://example2.com/webhook',
            event_types=['*'],
            secret='secret2',
            is_active=True
        ),
    ]
    
    mock_db.query.return_value.filter.return_value.all.return_value = webhooks
    
    with patch.object(webhook_service, 'deliver_webhook', new_callable=AsyncMock) as mock_deliver:
        mock_deliver.return_value = True
        
        await webhook_service.broadcast_event(
            tenant_id,
            'incident.created',
            {'test': 'data'}
        )
        
        assert mock_deliver.call_count == 2

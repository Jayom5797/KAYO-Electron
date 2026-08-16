import pytest
from unittest.mock import Mock, AsyncMock, patch
import uuid
from services.control_plane.services.event_broadcaster import EventBroadcaster


@pytest.fixture
def mock_db():
    return Mock()


@pytest.fixture
def event_broadcaster(mock_db):
    return EventBroadcaster(mock_db)


@pytest.mark.asyncio
async def test_broadcast_incident_created(event_broadcaster, mock_db):
    """Test broadcasting incident.created event"""
    tenant_id = uuid.uuid4()
    incident_id = uuid.uuid4()
    incident_data = {
        'title': 'Test Incident',
        'severity': 'high',
        'status': 'open'
    }
    
    with patch.object(event_broadcaster, '_broadcast_event', new_callable=AsyncMock) as mock_broadcast:
        await event_broadcaster.broadcast_incident_created(
            tenant_id, incident_id, incident_data
        )
        
        mock_broadcast.assert_called_once()
        call_args = mock_broadcast.call_args
        assert call_args[0][0] == tenant_id
        assert call_args[0][1] == 'incident.created'


@pytest.mark.asyncio
async def test_broadcast_deployment_status_changed(event_broadcaster, mock_db):
    """Test broadcasting deployment status change"""
    tenant_id = uuid.uuid4()
    deployment_id = uuid.uuid4()
    deployment_data = {'name': 'test-app'}
    
    with patch.object(event_broadcaster, '_broadcast_event', new_callable=AsyncMock) as mock_broadcast:
        await event_broadcaster.broadcast_deployment_status_changed(
            tenant_id, deployment_id, deployment_data, 'pending', 'running'
        )
        
        mock_broadcast.assert_called_once()
        call_args = mock_broadcast.call_args
        assert call_args[0][1] == 'deployment.succeeded'

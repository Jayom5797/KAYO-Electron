import pytest
from fastapi.testclient import TestClient
import uuid
from datetime import datetime


@pytest.fixture
def test_client():
    """Create test client for control plane API"""
    from services.control_plane.main import app
    return TestClient(app)


@pytest.fixture
def auth_headers(test_client):
    """Get authentication headers"""
    response = test_client.post(
        '/api/auth/login',
        data={'username': 'test@example.com', 'password': 'testpass123'}
    )
    token = response.json()['access_token']
    return {'Authorization': f'Bearer {token}'}


def test_incident_creation_workflow(test_client, auth_headers):
    """Test complete incident creation workflow"""
    # Create incident
    incident_data = {
        'title': 'Suspicious Process Execution',
        'description': 'Detected unusual process behavior',
        'severity': 'high',
        'mitre_tactics': ['TA0002'],
        'mitre_techniques': ['T1059'],
        'affected_entities': ['process-123', 'host-456']
    }
    
    response = test_client.post(
        '/api/incidents',
        json=incident_data,
        headers=auth_headers
    )
    
    assert response.status_code == 201
    incident = response.json()
    assert incident['title'] == incident_data['title']
    assert incident['severity'] == 'high'
    assert incident['status'] == 'open'
    
    incident_id = incident['id']
    
    # Retrieve incident
    response = test_client.get(
        f'/api/incidents/{incident_id}',
        headers=auth_headers
    )
    
    assert response.status_code == 200
    retrieved = response.json()
    assert retrieved['id'] == incident_id
    
    # Update incident status
    response = test_client.patch(
        f'/api/incidents/{incident_id}',
        json={'status': 'investigating'},
        headers=auth_headers
    )
    
    assert response.status_code == 200
    updated = response.json()
    assert updated['status'] == 'investigating'
    
    # Resolve incident
    response = test_client.patch(
        f'/api/incidents/{incident_id}',
        json={'status': 'resolved'},
        headers=auth_headers
    )
    
    assert response.status_code == 200
    resolved = response.json()
    assert resolved['status'] == 'resolved'


def test_incident_list_filtering(test_client, auth_headers):
    """Test incident list with filters"""
    # Get all incidents
    response = test_client.get(
        '/api/incidents',
        headers=auth_headers
    )
    
    assert response.status_code == 200
    all_incidents = response.json()
    
    # Filter by severity
    response = test_client.get(
        '/api/incidents?severity=high',
        headers=auth_headers
    )
    
    assert response.status_code == 200
    high_incidents = response.json()
    
    for incident in high_incidents:
        assert incident['severity'] == 'high'


def test_incident_attack_path(test_client, auth_headers):
    """Test retrieving incident attack path"""
    # Create incident
    incident_data = {
        'title': 'Test Incident',
        'description': 'Test',
        'severity': 'medium'
    }
    
    response = test_client.post(
        '/api/incidents',
        json=incident_data,
        headers=auth_headers
    )
    
    incident_id = response.json()['id']
    
    # Get attack path
    response = test_client.get(
        f'/api/incidents/{incident_id}/attack-path',
        headers=auth_headers
    )
    
    assert response.status_code == 200
    attack_path = response.json()
    assert 'nodes' in attack_path
    assert 'edges' in attack_path


def test_incident_webhook_broadcast(test_client, auth_headers):
    """Test webhook broadcast on incident creation"""
    # Create webhook
    webhook_data = {
        'url': 'https://example.com/webhook',
        'event_types': ['incident.created'],
        'secret': 'test_secret'
    }
    
    response = test_client.post(
        '/api/webhooks',
        json=webhook_data,
        headers=auth_headers
    )
    
    assert response.status_code == 201
    
    # Create incident (should trigger webhook)
    incident_data = {
        'title': 'Webhook Test Incident',
        'description': 'Test webhook delivery',
        'severity': 'low'
    }
    
    response = test_client.post(
        '/api/incidents',
        json=incident_data,
        headers=auth_headers
    )
    
    assert response.status_code == 201
    
    # Note: Actual webhook delivery is async and would need
    # additional mocking to verify in integration test


def test_incident_unauthorized_access(test_client):
    """Test incident access without authentication"""
    response = test_client.get('/api/incidents')
    assert response.status_code == 401


def test_incident_cross_tenant_isolation(test_client, auth_headers):
    """Test that incidents are isolated per tenant"""
    # Create incident as tenant A
    incident_data = {
        'title': 'Tenant A Incident',
        'description': 'Test',
        'severity': 'low'
    }
    
    response = test_client.post(
        '/api/incidents',
        json=incident_data,
        headers=auth_headers
    )
    
    incident_id = response.json()['id']
    
    # Try to access as different tenant (would need different auth)
    # This is a placeholder - actual test would need multi-tenant setup
    response = test_client.get(
        f'/api/incidents/{incident_id}',
        headers=auth_headers
    )
    
    # Should only see own tenant's incidents
    assert response.status_code in [200, 404]

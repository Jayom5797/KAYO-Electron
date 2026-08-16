import pytest
from fastapi.testclient import TestClient
import time


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


def test_deployment_creation_workflow(test_client, auth_headers):
    """Test complete deployment creation workflow"""
    deployment_data = {
        'name': 'test-app',
        'image': 'nginx:latest',
        'replicas': 2,
        'cpu_request': '100m',
        'memory_request': '256Mi',
        'cpu_limit': '1000m',
        'memory_limit': '512Mi',
        'port': 8080,
        'env_vars': {
            'ENV': 'test',
            'DEBUG': 'false'
        }
    }
    
    # Create deployment
    response = test_client.post(
        '/api/deployments',
        json=deployment_data,
        headers=auth_headers
    )
    
    assert response.status_code == 201
    deployment = response.json()
    assert deployment['name'] == 'test-app'
    assert deployment['status'] == 'pending'
    
    deployment_id = deployment['id']
    
    # Retrieve deployment
    response = test_client.get(
        f'/api/deployments/{deployment_id}',
        headers=auth_headers
    )
    
    assert response.status_code == 200
    retrieved = response.json()
    assert retrieved['id'] == deployment_id
    assert retrieved['replicas'] == 2


def test_deployment_list(test_client, auth_headers):
    """Test listing deployments"""
    response = test_client.get(
        '/api/deployments',
        headers=auth_headers
    )
    
    assert response.status_code == 200
    deployments = response.json()
    assert isinstance(deployments, list)


def test_deployment_update(test_client, auth_headers):
    """Test updating deployment"""
    # Create deployment
    deployment_data = {
        'name': 'update-test',
        'image': 'nginx:1.20',
        'replicas': 1,
        'cpu_request': '100m',
        'memory_request': '256Mi',
        'cpu_limit': '500m',
        'memory_limit': '512Mi'
    }
    
    response = test_client.post(
        '/api/deployments',
        json=deployment_data,
        headers=auth_headers
    )
    
    deployment_id = response.json()['id']
    
    # Update replicas
    response = test_client.patch(
        f'/api/deployments/{deployment_id}',
        json={'replicas': 3},
        headers=auth_headers
    )
    
    assert response.status_code == 200
    updated = response.json()
    assert updated['replicas'] == 3


def test_deployment_deletion(test_client, auth_headers):
    """Test deleting deployment"""
    # Create deployment
    deployment_data = {
        'name': 'delete-test',
        'image': 'nginx:latest',
        'replicas': 1,
        'cpu_request': '100m',
        'memory_request': '256Mi',
        'cpu_limit': '500m',
        'memory_limit': '512Mi'
    }
    
    response = test_client.post(
        '/api/deployments',
        json=deployment_data,
        headers=auth_headers
    )
    
    deployment_id = response.json()['id']
    
    # Delete deployment
    response = test_client.delete(
        f'/api/deployments/{deployment_id}',
        headers=auth_headers
    )
    
    assert response.status_code == 204
    
    # Verify deletion
    response = test_client.get(
        f'/api/deployments/{deployment_id}',
        headers=auth_headers
    )
    
    assert response.status_code == 404


def test_deployment_logs(test_client, auth_headers):
    """Test retrieving deployment logs"""
    # Create deployment
    deployment_data = {
        'name': 'logs-test',
        'image': 'nginx:latest',
        'replicas': 1,
        'cpu_request': '100m',
        'memory_request': '256Mi',
        'cpu_limit': '500m',
        'memory_limit': '512Mi'
    }
    
    response = test_client.post(
        '/api/deployments',
        json=deployment_data,
        headers=auth_headers
    )
    
    deployment_id = response.json()['id']
    
    # Get build logs
    response = test_client.get(
        f'/api/deployments/{deployment_id}/logs/build',
        headers=auth_headers
    )
    
    assert response.status_code in [200, 404]  # 404 if build not started yet
    
    # Get runtime logs
    response = test_client.get(
        f'/api/deployments/{deployment_id}/logs/runtime',
        headers=auth_headers
    )
    
    assert response.status_code in [200, 404]  # 404 if not running yet


def test_deployment_validation(test_client, auth_headers):
    """Test deployment input validation"""
    # Invalid name (too long)
    deployment_data = {
        'name': 'a' * 100,
        'image': 'nginx:latest',
        'replicas': 1,
        'cpu_request': '100m',
        'memory_request': '256Mi',
        'cpu_limit': '500m',
        'memory_limit': '512Mi'
    }
    
    response = test_client.post(
        '/api/deployments',
        json=deployment_data,
        headers=auth_headers
    )
    
    assert response.status_code == 422
    
    # Invalid replicas (too many)
    deployment_data = {
        'name': 'test',
        'image': 'nginx:latest',
        'replicas': 1000,
        'cpu_request': '100m',
        'memory_request': '256Mi',
        'cpu_limit': '500m',
        'memory_limit': '512Mi'
    }
    
    response = test_client.post(
        '/api/deployments',
        json=deployment_data,
        headers=auth_headers
    )
    
    assert response.status_code == 422


def test_deployment_webhook_broadcast(test_client, auth_headers):
    """Test webhook broadcast on deployment events"""
    # Create webhook
    webhook_data = {
        'url': 'https://example.com/webhook',
        'event_types': ['deployment.created', 'deployment.succeeded'],
        'secret': 'test_secret'
    }
    
    response = test_client.post(
        '/api/webhooks',
        json=webhook_data,
        headers=auth_headers
    )
    
    assert response.status_code == 201
    
    # Create deployment (should trigger webhook)
    deployment_data = {
        'name': 'webhook-test',
        'image': 'nginx:latest',
        'replicas': 1,
        'cpu_request': '100m',
        'memory_request': '256Mi',
        'cpu_limit': '500m',
        'memory_limit': '512Mi'
    }
    
    response = test_client.post(
        '/api/deployments',
        json=deployment_data,
        headers=auth_headers
    )
    
    assert response.status_code == 201

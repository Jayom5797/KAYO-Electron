import pytest
from unittest.mock import Mock, patch
import uuid
import base64
from services.control_plane.services.secret_manager import SecretManager


@pytest.fixture
def mock_k8s_client():
    with patch('kubernetes.client.CoreV1Api') as mock:
        yield mock.return_value


@pytest.fixture
def secret_manager(mock_k8s_client):
    return SecretManager()


def test_create_neo4j_secret(secret_manager, mock_k8s_client):
    """Test creating Neo4j secret in Kubernetes"""
    tenant_id = uuid.uuid4()
    namespace = f"tenant-{tenant_id}"
    password = "test_password_123"
    
    secret_manager.create_neo4j_secret(tenant_id, password)
    
    mock_k8s_client.create_namespaced_secret.assert_called_once()
    call_args = mock_k8s_client.create_namespaced_secret.call_args
    
    assert call_args[1]['namespace'] == namespace
    secret = call_args[1]['body']
    assert secret.metadata.name == 'neo4j-credentials'
    assert 'password' in secret.data


def test_get_neo4j_credentials(secret_manager, mock_k8s_client):
    """Test retrieving Neo4j credentials from Kubernetes"""
    tenant_id = uuid.uuid4()
    namespace = f"tenant-{tenant_id}"
    password = "test_password_123"
    
    mock_secret = Mock()
    mock_secret.data = {
        'username': base64.b64encode(b'neo4j').decode(),
        'password': base64.b64encode(password.encode()).decode()
    }
    mock_k8s_client.read_namespaced_secret.return_value = mock_secret
    
    username, retrieved_password = secret_manager.get_neo4j_credentials(tenant_id)
    
    assert username == 'neo4j'
    assert retrieved_password == password


def test_delete_neo4j_secret(secret_manager, mock_k8s_client):
    """Test deleting Neo4j secret from Kubernetes"""
    tenant_id = uuid.uuid4()
    namespace = f"tenant-{tenant_id}"
    
    secret_manager.delete_neo4j_secret(tenant_id)
    
    mock_k8s_client.delete_namespaced_secret.assert_called_once_with(
        name='neo4j-credentials',
        namespace=namespace
    )


def test_rotate_neo4j_password(secret_manager, mock_k8s_client):
    """Test rotating Neo4j password"""
    tenant_id = uuid.uuid4()
    new_password = "new_password_456"
    
    secret_manager.rotate_neo4j_password(tenant_id, new_password)
    
    # Should delete old secret and create new one
    assert mock_k8s_client.delete_namespaced_secret.called
    assert mock_k8s_client.create_namespaced_secret.called


def test_secret_not_found(secret_manager, mock_k8s_client):
    """Test handling of non-existent secret"""
    from kubernetes.client.rest import ApiException
    
    tenant_id = uuid.uuid4()
    mock_k8s_client.read_namespaced_secret.side_effect = ApiException(status=404)
    
    with pytest.raises(Exception):
        secret_manager.get_neo4j_credentials(tenant_id)


def test_password_encoding(secret_manager):
    """Test password is properly base64 encoded"""
    password = "test_password_!@#$%"
    encoded = base64.b64encode(password.encode()).decode()
    decoded = base64.b64decode(encoded).decode()
    
    assert decoded == password

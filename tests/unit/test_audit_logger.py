import pytest
from unittest.mock import Mock, patch
from datetime import datetime
import uuid
from services.control_plane.api.middleware.audit_logger import AuditLogger
from services.control_plane.models.audit_log import AuditLog


@pytest.fixture
def mock_db():
    """Mock database session"""
    return Mock()


@pytest.fixture
def audit_logger(mock_db):
    """Create AuditLogger instance"""
    return AuditLogger(mock_db)


@pytest.fixture
def mock_request():
    """Mock FastAPI request"""
    request = Mock()
    request.method = 'POST'
    request.url.path = '/api/v1/deployments'
    request.client.host = '192.168.1.100'
    request.headers = {
        'user-agent': 'Mozilla/5.0',
        'authorization': 'Bearer token123'
    }
    return request


def test_log_write_operation(audit_logger, mock_db, mock_request):
    """Test logging write operation"""
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    request_body = {'name': 'test-deployment', 'image': 'nginx:latest'}
    response_body = {'id': str(uuid.uuid4()), 'status': 'pending'}
    
    audit_logger.log_request(
        tenant_id=tenant_id,
        user_id=user_id,
        request=mock_request,
        request_body=request_body,
        response_body=response_body,
        status_code=201
    )
    
    mock_db.add.assert_called_once()
    mock_db.commit.assert_called_once()
    
    # Verify AuditLog was created with correct data
    audit_log = mock_db.add.call_args[0][0]
    assert isinstance(audit_log, AuditLog)
    assert audit_log.tenant_id == tenant_id
    assert audit_log.user_id == user_id
    assert audit_log.action == 'POST'
    assert audit_log.resource == '/api/v1/deployments'
    assert audit_log.status_code == 201


def test_log_read_operation_skipped(audit_logger, mock_db, mock_request):
    """Test that read operations are not logged"""
    mock_request.method = 'GET'
    
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    
    audit_logger.log_request(
        tenant_id=tenant_id,
        user_id=user_id,
        request=mock_request,
        request_body=None,
        response_body={'data': 'test'},
        status_code=200
    )
    
    # Should not add to database
    mock_db.add.assert_not_called()


def test_redact_sensitive_fields(audit_logger):
    """Test sensitive field redaction"""
    data = {
        'username': 'testuser',
        'password': 'secret123',
        'token': 'abc123',
        'api_key': 'key123',
        'secret': 'mysecret',
        'normal_field': 'visible'
    }
    
    redacted = audit_logger._redact_sensitive_fields(data)
    
    assert redacted['username'] == 'testuser'
    assert redacted['password'] == '[REDACTED]'
    assert redacted['token'] == '[REDACTED]'
    assert redacted['api_key'] == '[REDACTED]'
    assert redacted['secret'] == '[REDACTED]'
    assert redacted['normal_field'] == 'visible'


def test_redact_nested_sensitive_fields(audit_logger):
    """Test redaction of nested sensitive fields"""
    data = {
        'user': {
            'username': 'testuser',
            'password': 'secret123'
        },
        'config': {
            'api_key': 'key123',
            'timeout': 30
        }
    }
    
    redacted = audit_logger._redact_sensitive_fields(data)
    
    assert redacted['user']['username'] == 'testuser'
    assert redacted['user']['password'] == '[REDACTED]'
    assert redacted['config']['api_key'] == '[REDACTED]'
    assert redacted['config']['timeout'] == 30


def test_log_authentication_attempt(audit_logger, mock_db, mock_request):
    """Test logging authentication attempt"""
    mock_request.url.path = '/api/v1/auth/login'
    
    request_body = {'email': 'user@example.com', 'password': 'secret'}
    response_body = {'token': 'jwt123'}
    
    audit_logger.log_request(
        tenant_id=None,
        user_id=None,
        request=mock_request,
        request_body=request_body,
        response_body=response_body,
        status_code=200
    )
    
    mock_db.add.assert_called_once()
    
    audit_log = mock_db.add.call_args[0][0]
    assert audit_log.resource == '/api/v1/auth/login'
    
    # Verify password was redacted
    assert '[REDACTED]' in str(audit_log.request_body)


def test_log_failed_request(audit_logger, mock_db, mock_request):
    """Test logging failed request"""
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    
    audit_logger.log_request(
        tenant_id=tenant_id,
        user_id=user_id,
        request=mock_request,
        request_body={'name': 'test'},
        response_body={'error': 'Validation failed'},
        status_code=400
    )
    
    mock_db.add.assert_called_once()
    
    audit_log = mock_db.add.call_args[0][0]
    assert audit_log.status_code == 400


def test_log_database_error_handling(audit_logger, mock_db, mock_request):
    """Test graceful handling of database errors"""
    mock_db.add.side_effect = Exception('Database error')
    
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    
    # Should not raise exception
    try:
        audit_logger.log_request(
            tenant_id=tenant_id,
            user_id=user_id,
            request=mock_request,
            request_body={'test': 'data'},
            response_body={'result': 'ok'},
            status_code=200
        )
    except Exception:
        pytest.fail('AuditLogger should handle database errors gracefully')


def test_ip_address_capture(audit_logger, mock_db, mock_request):
    """Test IP address is captured correctly"""
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    
    audit_logger.log_request(
        tenant_id=tenant_id,
        user_id=user_id,
        request=mock_request,
        request_body={},
        response_body={},
        status_code=200
    )
    
    audit_log = mock_db.add.call_args[0][0]
    assert audit_log.ip_address == '192.168.1.100'


def test_user_agent_capture(audit_logger, mock_db, mock_request):
    """Test user agent is captured correctly"""
    tenant_id = uuid.uuid4()
    user_id = uuid.uuid4()
    
    audit_logger.log_request(
        tenant_id=tenant_id,
        user_id=user_id,
        request=mock_request,
        request_body={},
        response_body={},
        status_code=200
    )
    
    audit_log = mock_db.add.call_args[0][0]
    assert audit_log.user_agent == 'Mozilla/5.0'

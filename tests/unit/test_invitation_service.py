import pytest
from unittest.mock import Mock, patch
import uuid
from datetime import datetime, timedelta
from services.control_plane.services.invitation_service import InvitationService


@pytest.fixture
def mock_db():
    return Mock()


@pytest.fixture
def invitation_service(mock_db):
    return InvitationService(mock_db)


def test_create_invitation(invitation_service, mock_db):
    """Test creating invitation"""
    tenant_id = uuid.uuid4()
    email = 'newuser@example.com'
    role = 'member'
    
    invitation = invitation_service.create_invitation(
        tenant_id=tenant_id,
        email=email,
        role=role,
        invited_by=uuid.uuid4()
    )
    
    mock_db.add.assert_called_once()
    mock_db.commit.assert_called_once()
    assert invitation.email == email
    assert invitation.role == role


def test_validate_invitation_success(invitation_service, mock_db):
    """Test successful invitation validation"""
    token = 'valid_token_123'
    
    mock_invitation = Mock()
    mock_invitation.status = 'pending'
    mock_invitation.expires_at = datetime.utcnow() + timedelta(days=1)
    mock_invitation.tenant_id = uuid.uuid4()
    
    mock_db.query.return_value.filter.return_value.first.return_value = mock_invitation
    
    result = invitation_service.validate_invitation(token)
    
    assert result is not None
    assert result.tenant_id == mock_invitation.tenant_id


def test_validate_invitation_expired(invitation_service, mock_db):
    """Test expired invitation validation"""
    token = 'expired_token'
    
    mock_invitation = Mock()
    mock_invitation.status = 'pending'
    mock_invitation.expires_at = datetime.utcnow() - timedelta(days=1)
    
    mock_db.query.return_value.filter.return_value.first.return_value = mock_invitation
    
    result = invitation_service.validate_invitation(token)
    
    assert result is None

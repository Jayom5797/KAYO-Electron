import pytest
from unittest.mock import Mock, patch, MagicMock
from services.control_plane.services.email_service import EmailService


@pytest.fixture
def email_service():
    return EmailService(
        smtp_host='smtp.example.com',
        smtp_port=587,
        smtp_user='test@example.com',
        smtp_password='password',
        from_email='noreply@kayo.io',
        from_name='KAYO Security'
    )


def test_send_email_success(email_service):
    """Test successful email sending"""
    with patch('smtplib.SMTP') as mock_smtp:
        mock_server = MagicMock()
        mock_smtp.return_value.__enter__.return_value = mock_server
        
        result = email_service.send_email(
            to_email='user@example.com',
            subject='Test Email',
            html_content='<p>Test</p>',
            text_content='Test'
        )
        
        assert result is True
        mock_server.starttls.assert_called_once()
        mock_server.login.assert_called_once()
        mock_server.send_message.assert_called_once()


def test_send_email_failure(email_service):
    """Test email sending failure"""
    with patch('smtplib.SMTP') as mock_smtp:
        mock_smtp.return_value.__enter__.side_effect = Exception('SMTP error')
        
        result = email_service.send_email(
            to_email='user@example.com',
            subject='Test Email',
            html_content='<p>Test</p>'
        )
        
        assert result is False


def test_send_invitation_email(email_service):
    """Test invitation email sending"""
    with patch.object(email_service, 'send_email') as mock_send:
        mock_send.return_value = True
        
        result = email_service.send_invitation_email(
            to_email='newuser@example.com',
            invitation_token='abc123',
            tenant_name='Acme Corp',
            inviter_email='admin@acme.com',
            role='member'
        )
        
        assert result is True
        mock_send.assert_called_once()
        
        call_args = mock_send.call_args
        assert 'newuser@example.com' in call_args[0]
        assert 'Acme Corp' in call_args[0][1]


def test_send_incident_alert_email(email_service):
    """Test incident alert email sending"""
    with patch.object(email_service, 'send_email') as mock_send:
        mock_send.return_value = True
        
        result = email_service.send_incident_alert_email(
            to_email='admin@example.com',
            incident_id='123',
            incident_title='Suspicious Activity',
            severity='high',
            description='Detected unusual behavior',
            tenant_name='Acme Corp'
        )
        
        assert result is True
        mock_send.assert_called_once()


def test_invitation_template_rendering(email_service):
    """Test invitation email template rendering"""
    html = email_service._render_invitation_template(
        to_email='user@example.com',
        invitation_url='https://app.kayo.io/register?token=abc',
        tenant_name='Test Org',
        inviter_email='admin@test.com',
        role='admin'
    )
    
    assert 'Test Org' in html
    assert 'admin@test.com' in html
    assert 'admin' in html
    assert 'https://app.kayo.io/register?token=abc' in html


def test_incident_alert_template_rendering(email_service):
    """Test incident alert email template rendering"""
    html = email_service._render_incident_alert_template(
        incident_title='Security Breach',
        severity='critical',
        description='Unauthorized access detected',
        incident_url='https://app.kayo.io/incidents/123',
        tenant_name='Acme Corp'
    )
    
    assert 'Security Breach' in html
    assert 'critical' in html.lower()
    assert 'Unauthorized access detected' in html
    assert 'https://app.kayo.io/incidents/123' in html

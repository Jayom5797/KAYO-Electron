import logging
from typing import Optional
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from jinja2 import Template

logger = logging.getLogger(__name__)


class EmailService:
    """
    Email service for sending transactional emails.
    
    Supports multiple providers:
    - SMTP (generic)
    - SendGrid (via SMTP)
    - AWS SES (via SMTP)
    
    Security:
    - TLS encryption
    - Credential management via environment variables
    
    Time complexity: O(1) per email
    """
    
    def __init__(
        self,
        smtp_host: str,
        smtp_port: int,
        smtp_user: str,
        smtp_password: str,
        from_email: str,
        from_name: str = "KAYO Security"
    ):
        """
        Initialize email service.
        
        Args:
            smtp_host: SMTP server hostname
            smtp_port: SMTP server port (587 for TLS, 465 for SSL)
            smtp_user: SMTP username
            smtp_password: SMTP password
            from_email: Sender email address
            from_name: Sender display name
        """
        self.smtp_host = smtp_host
        self.smtp_port = smtp_port
        self.smtp_user = smtp_user
        self.smtp_password = smtp_password
        self.from_email = from_email
        self.from_name = from_name
    
    def send_email(
        self,
        to_email: str,
        subject: str,
        html_content: str,
        text_content: Optional[str] = None
    ) -> bool:
        """
        Send email via SMTP.
        
        Args:
            to_email: Recipient email address
            subject: Email subject
            html_content: HTML email body
            text_content: Plain text fallback (optional)
        
        Returns:
            True if sent successfully, False otherwise
        
        Security: Uses TLS encryption
        Time complexity: O(1)
        """
        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            msg['From'] = f"{self.from_name} <{self.from_email}>"
            msg['To'] = to_email
            
            # Add text and HTML parts
            if text_content:
                part1 = MIMEText(text_content, 'plain')
                msg.attach(part1)
            
            part2 = MIMEText(html_content, 'html')
            msg.attach(part2)
            
            # Send via SMTP
            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.send_message(msg)
            
            logger.info(f"Email sent successfully to {to_email}")
            return True
        
        except Exception as e:
            logger.error(f"Failed to send email to {to_email}: {e}")
            return False
    
    def send_invitation_email(
        self,
        to_email: str,
        invitation_token: str,
        tenant_name: str,
        inviter_email: str,
        role: str
    ) -> bool:
        """
        Send invitation email to new team member.
        
        Args:
            to_email: Invitee email address
            invitation_token: Invitation token
            tenant_name: Organization name
            inviter_email: Email of person who sent invitation
            role: Role being assigned (member, admin)
        
        Returns:
            True if sent successfully
        
        Time complexity: O(1)
        """
        # Generate invitation URL
        invitation_url = f"https://app.kayo.io/register?token={invitation_token}"
        
        # Render HTML template
        html_content = self._render_invitation_template(
            to_email=to_email,
            invitation_url=invitation_url,
            tenant_name=tenant_name,
            inviter_email=inviter_email,
            role=role
        )
        
        # Plain text fallback
        text_content = f"""
You've been invited to join {tenant_name} on KAYO

{inviter_email} has invited you to join their security team as a {role}.

Click the link below to accept the invitation and create your account:
{invitation_url}

This invitation will expire in 7 days.

If you didn't expect this invitation, you can safely ignore this email.

---
KAYO - Cloud-Native Security Platform
        """.strip()
        
        subject = f"You've been invited to join {tenant_name} on KAYO"
        
        return self.send_email(to_email, subject, html_content, text_content)
    
    def send_incident_alert_email(
        self,
        to_email: str,
        incident_id: str,
        incident_title: str,
        severity: str,
        description: str,
        tenant_name: str
    ) -> bool:
        """
        Send incident alert email.
        
        Args:
            to_email: Recipient email
            incident_id: Incident UUID
            incident_title: Incident title
            severity: Severity level
            description: Incident description
            tenant_name: Organization name
        
        Returns:
            True if sent successfully
        
        Time complexity: O(1)
        """
        incident_url = f"https://app.kayo.io/dashboard/incidents/{incident_id}"
        
        html_content = self._render_incident_alert_template(
            incident_title=incident_title,
            severity=severity,
            description=description,
            incident_url=incident_url,
            tenant_name=tenant_name
        )
        
        text_content = f"""
SECURITY ALERT - {severity.upper()}

{incident_title}

{description}

View incident details:
{incident_url}

---
{tenant_name} | KAYO Security Platform
        """.strip()
        
        subject = f"[{severity.upper()}] Security Alert: {incident_title}"
        
        return self.send_email(to_email, subject, html_content, text_content)
    
    @staticmethod
    def _render_invitation_template(
        to_email: str,
        invitation_url: str,
        tenant_name: str,
        inviter_email: str,
        role: str
    ) -> str:
        """Render invitation email HTML template"""
        template = Template("""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invitation to {{ tenant_name }}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: #000; color: #fff; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">KAYO</h1>
        <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Cloud-Native Security Platform</p>
    </div>
    
    <div style="background-color: #f9f9f9; padding: 30px; margin-top: 20px; border-radius: 8px;">
        <h2 style="margin-top: 0; color: #000;">You've been invited!</h2>
        
        <p><strong>{{ inviter_email }}</strong> has invited you to join <strong>{{ tenant_name }}</strong> as a <strong>{{ role }}</strong>.</p>
        
        <p>KAYO provides real-time threat detection and behavior analysis for cloud-native applications. Join your team to:</p>
        
        <ul style="padding-left: 20px;">
            <li>Monitor security incidents in real-time</li>
            <li>Investigate attack patterns with behavior graphs</li>
            <li>Manage application deployments</li>
            <li>Collaborate on incident response</li>
        </ul>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{{ invitation_url }}" style="display: inline-block; background-color: #000; color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 4px; font-weight: 500;">Accept Invitation</a>
        </div>
        
        <p style="font-size: 14px; color: #666;">This invitation will expire in 7 days.</p>
        
        <p style="font-size: 14px; color: #666;">If you didn't expect this invitation, you can safely ignore this email.</p>
    </div>
    
    <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #999;">
        <p>KAYO Security Platform</p>
        <p>This is an automated message, please do not reply.</p>
    </div>
</body>
</html>
        """)
        
        return template.render(
            to_email=to_email,
            invitation_url=invitation_url,
            tenant_name=tenant_name,
            inviter_email=inviter_email,
            role=role
        )
    
    @staticmethod
    def _render_incident_alert_template(
        incident_title: str,
        severity: str,
        description: str,
        incident_url: str,
        tenant_name: str
    ) -> str:
        """Render incident alert email HTML template"""
        severity_colors = {
            'critical': '#dc2626',
            'high': '#ea580c',
            'medium': '#ca8a04',
            'low': '#2563eb',
        }
        
        color = severity_colors.get(severity.lower(), '#6b7280')
        
        template = Template("""
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Security Alert</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="background-color: {{ color }}; color: #fff; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">SECURITY ALERT</h1>
        <p style="margin: 5px 0 0 0; font-size: 16px; font-weight: 600;">{{ severity|upper }}</p>
    </div>
    
    <div style="background-color: #f9f9f9; padding: 30px; margin-top: 20px; border-radius: 8px;">
        <h2 style="margin-top: 0; color: #000;">{{ incident_title }}</h2>
        
        <p>{{ description }}</p>
        
        <div style="text-align: center; margin: 30px 0;">
            <a href="{{ incident_url }}" style="display: inline-block; background-color: #000; color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 4px; font-weight: 500;">View Incident Details</a>
        </div>
        
        <p style="font-size: 14px; color: #666;">Investigate this incident immediately to determine the scope and impact.</p>
    </div>
    
    <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #999;">
        <p>{{ tenant_name }} | KAYO Security Platform</p>
        <p>This is an automated alert, please do not reply.</p>
    </div>
</body>
</html>
        """)
        
        return template.render(
            incident_title=incident_title,
            severity=severity,
            description=description,
            incident_url=incident_url,
            tenant_name=tenant_name,
            color=color
        )

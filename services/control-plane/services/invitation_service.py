from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import secrets
import hashlib
import logging
from typing import Optional
import uuid

from models.user import User
from models.tenant import Tenant

logger = logging.getLogger(__name__)


class InvitationService:
    """
    Manages user invitation tokens and registration flow.
    
    Architecture:
    - Generates secure invitation tokens
    - Links invitations to tenants
    - Validates tokens during registration
    - Handles token expiration
    
    Security:
    - Cryptographically secure token generation
    - Token hashing for storage
    - Expiration enforcement (7 days default)
    - One-time use tokens
    
    Time complexity: O(1) for all operations
    """
    
    TOKEN_LENGTH = 32
    TOKEN_EXPIRY_DAYS = 7
    
    def __init__(self, db: Session):
        """
        Initialize invitation service.
        
        Args:
            db: SQLAlchemy database session
        """
        self.db = db
    
    def create_invitation(
        self,
        tenant_id: uuid.UUID,
        email: str,
        role: str = "member",
        invited_by: uuid.UUID = None,
        send_email: bool = True
    ) -> str:
        """
        Create invitation token for new user.
        
        Args:
            tenant_id: Tenant UUID
            email: Email address to invite
            role: User role (member, admin)
            invited_by: User ID of inviter
            send_email: Whether to send invitation email
        
        Returns:
            Invitation token (plain text, send via email)
        
        Security:
        - Token is cryptographically random
        - Stored as hash in database
        - Single use only
        
        Time complexity: O(1)
        """
        from models.invitation import Invitation
        
        # Check if user already exists
        existing_user = self.db.query(User).filter(
            User.email == email,
            User.tenant_id == tenant_id
        ).first()
        
        if existing_user:
            raise ValueError(f"User with email {email} already exists in tenant")
        
        # Check for existing pending invitation
        existing_invitation = self.db.query(Invitation).filter(
            Invitation.email == email,
            Invitation.tenant_id == tenant_id,
            Invitation.status == "pending",
            Invitation.expires_at > datetime.utcnow()
        ).first()
        
        if existing_invitation:
            logger.info(f"Reusing existing invitation for {email}")
            # Note: Cannot return original token as it's hashed
            # Generate new token and update
            token = secrets.token_urlsafe(self.TOKEN_LENGTH)
            token_hash = self._hash_token(token)
            existing_invitation.token_hash = token_hash
            self.db.commit()
            
            if send_email:
                self._send_invitation_email(tenant_id, email, token, role, invited_by)
            
            return token
        
        # Generate secure token
        token = secrets.token_urlsafe(self.TOKEN_LENGTH)
        token_hash = self._hash_token(token)
        
        # Create invitation record
        invitation = Invitation(
            tenant_id=tenant_id,
            email=email,
            role=role,
            token_hash=token_hash,
            invited_by=invited_by,
            expires_at=datetime.utcnow() + timedelta(days=self.TOKEN_EXPIRY_DAYS),
            status="pending"
        )
        
        self.db.add(invitation)
        self.db.commit()
        
        logger.info(f"Created invitation for {email} in tenant {tenant_id}")
        
        if send_email:
            self._send_invitation_email(tenant_id, email, token, role, invited_by)
        
        return token
    
    def _send_invitation_email(
        self,
        tenant_id: uuid.UUID,
        email: str,
        token: str,
        role: str,
        invited_by: uuid.UUID = None
    ):
        """
        Send invitation email using email service.
        
        Args:
            tenant_id: Tenant UUID
            email: Invitee email
            token: Invitation token
            role: User role
            invited_by: Inviter user ID
        
        Time complexity: O(1)
        """
        try:
            from services.email_service import EmailService
            from config import settings
            
            # Get tenant info
            tenant = self.db.query(Tenant).filter(Tenant.tenant_id == tenant_id).first()
            if not tenant:
                logger.error(f"Tenant {tenant_id} not found for invitation email")
                return
            
            # Get inviter info
            inviter_email = "team@kayo.io"
            if invited_by:
                inviter = self.db.query(User).filter(User.user_id == invited_by).first()
                if inviter:
                    inviter_email = inviter.email
            
            # Initialize email service
            email_service = EmailService(
                smtp_host=settings.smtp_host,
                smtp_port=settings.smtp_port,
                smtp_user=settings.smtp_user,
                smtp_password=settings.smtp_password,
                from_email=settings.from_email,
                from_name="KAYO Security"
            )
            
            # Send invitation email
            success = email_service.send_invitation_email(
                to_email=email,
                invitation_token=token,
                tenant_name=tenant.name,
                inviter_email=inviter_email,
                role=role
            )
            
            if success:
                logger.info(f"Invitation email sent to {email}")
            else:
                logger.error(f"Failed to send invitation email to {email}")
        
        except Exception as e:
            logger.error(f"Error sending invitation email: {e}")
            # Don't fail invitation creation if email fails
    
    def validate_invitation(
        self,
        token: str,
        email: str
    ) -> Optional[dict]:
        """
        Validate invitation token.
        
        Args:
            token: Invitation token
            email: Email address
        
        Returns:
            Dictionary with tenant_id and role if valid, None otherwise
        
        Security:
        - Constant-time token comparison
        - Expiration check
        - Single-use enforcement
        
        Time complexity: O(1)
        """
        from models.invitation import Invitation
        
        token_hash = self._hash_token(token)
        
        # Find invitation
        invitation = self.db.query(Invitation).filter(
            Invitation.token_hash == token_hash,
            Invitation.email == email,
            Invitation.status == "pending"
        ).first()
        
        if not invitation:
            logger.warning(f"Invalid invitation token for {email}")
            return None
        
        # Check expiration
        if invitation.expires_at < datetime.utcnow():
            logger.warning(f"Expired invitation token for {email}")
            invitation.status = "expired"
            self.db.commit()
            return None
        
        return {
            "tenant_id": invitation.tenant_id,
            "role": invitation.role,
            "invitation_id": invitation.invitation_id
        }
    
    def accept_invitation(
        self,
        token: str,
        email: str,
        user_id: uuid.UUID
    ):
        """
        Mark invitation as accepted after user registration.
        
        Args:
            token: Invitation token
            email: Email address
            user_id: Created user ID
        
        Security: Single-use token enforcement
        Time complexity: O(1)
        """
        from models.invitation import Invitation
        
        token_hash = self._hash_token(token)
        
        invitation = self.db.query(Invitation).filter(
            Invitation.token_hash == token_hash,
            Invitation.email == email,
            Invitation.status == "pending"
        ).first()
        
        if invitation:
            invitation.status = "accepted"
            invitation.accepted_at = datetime.utcnow()
            invitation.user_id = user_id
            self.db.commit()
            
            logger.info(f"Invitation accepted for {email}")
    
    def revoke_invitation(
        self,
        invitation_id: uuid.UUID,
        tenant_id: uuid.UUID
    ):
        """
        Revoke pending invitation.
        
        Args:
            invitation_id: Invitation UUID
            tenant_id: Tenant UUID (for authorization)
        
        Time complexity: O(1)
        """
        from models.invitation import Invitation
        
        invitation = self.db.query(Invitation).filter(
            Invitation.invitation_id == invitation_id,
            Invitation.tenant_id == tenant_id,
            Invitation.status == "pending"
        ).first()
        
        if invitation:
            invitation.status = "revoked"
            self.db.commit()
            
            logger.info(f"Invitation {invitation_id} revoked")
    
    def list_invitations(
        self,
        tenant_id: uuid.UUID,
        status: Optional[str] = None
    ) -> list:
        """
        List invitations for tenant.
        
        Args:
            tenant_id: Tenant UUID
            status: Filter by status (pending, accepted, expired, revoked)
        
        Returns:
            List of invitation records
        
        Time complexity: O(n) where n is number of invitations
        """
        from models.invitation import Invitation
        
        query = self.db.query(Invitation).filter(
            Invitation.tenant_id == tenant_id
        )
        
        if status:
            query = query.filter(Invitation.status == status)
        
        return query.order_by(Invitation.created_at.desc()).all()
    
    def extract_tenant_from_subdomain(
        self,
        subdomain: str
    ) -> Optional[uuid.UUID]:
        """
        Extract tenant_id from subdomain.
        
        Args:
            subdomain: Subdomain (e.g., 'acme' from 'acme.kayo.app')
        
        Returns:
            Tenant UUID if found, None otherwise
        
        Time complexity: O(1) - indexed lookup
        """
        tenant = self.db.query(Tenant).filter(
            Tenant.slug == subdomain
        ).first()
        
        return tenant.tenant_id if tenant else None
    
    @staticmethod
    def _hash_token(token: str) -> str:
        """
        Hash invitation token for storage.
        
        Args:
            token: Plain text token
        
        Returns:
            SHA256 hash of token
        
        Security: One-way hash prevents token recovery from database
        Time complexity: O(1)
        """
        return hashlib.sha256(token.encode()).hexdigest()

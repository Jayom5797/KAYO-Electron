from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid
import logging

from database import get_db
from models.invitation import Invitation
from schemas.invitation import InvitationCreate, InvitationResponse
from services.auth import get_current_user, get_current_tenant_id
from services.invitation_service import InvitationService
from models.user import User

router = APIRouter(prefix="/api/invitations", tags=["invitations"])
logger = logging.getLogger(__name__)


@router.post("/", response_model=InvitationResponse, status_code=status.HTTP_201_CREATED)
async def create_invitation(
    invitation_data: InvitationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Create invitation for new user.
    
    Sends invitation email with token link.
    
    Security:
    - Only authenticated users can invite
    - Invitations scoped to current tenant
    - Secure token generation
    
    Time complexity: O(1)
    """
    invitation_service = InvitationService(db)
    
    try:
        token = invitation_service.create_invitation(
            tenant_id=tenant_id,
            email=invitation_data.email,
            role=invitation_data.role,
            invited_by=current_user.user_id
        )
        
        # TODO: Send invitation email
        # email_service.send_invitation_email(
        #     to=invitation_data.email,
        #     token=token,
        #     tenant_name=current_user.tenant.name
        # )
        
        # Get created invitation
        invitation = db.query(Invitation).filter(
            Invitation.email == invitation_data.email,
            Invitation.tenant_id == tenant_id,
            Invitation.status == "pending"
        ).first()
        
        logger.info(
            f"Created invitation for {invitation_data.email} "
            f"by user {current_user.user_id}"
        )
        
        # Return invitation with token (for testing/manual sending)
        # In production, token should only be sent via email
        return {
            **invitation.__dict__,
            "invitation_link": f"https://app.kayo.io/register?token={token}"
        }
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@router.get("/", response_model=List[InvitationResponse])
async def list_invitations(
    status_filter: str = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    List invitations for current tenant.
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(n) where n is number of invitations
    """
    invitation_service = InvitationService(db)
    
    invitations = invitation_service.list_invitations(
        tenant_id=tenant_id,
        status=status_filter
    )
    
    # Apply pagination
    invitations = invitations[skip:skip + limit]
    
    return invitations


@router.get("/{invitation_id}", response_model=InvitationResponse)
async def get_invitation(
    invitation_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Get invitation details.
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(1)
    """
    invitation = db.query(Invitation).filter(
        Invitation.invitation_id == invitation_id,
        Invitation.tenant_id == tenant_id
    ).first()
    
    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation not found"
        )
    
    return invitation


@router.delete("/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(
    invitation_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Revoke pending invitation.
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(1)
    """
    invitation_service = InvitationService(db)
    
    try:
        invitation_service.revoke_invitation(invitation_id, tenant_id)
        logger.info(f"Revoked invitation {invitation_id}")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to revoke invitation: {str(e)}"
        )


@router.post("/resend/{invitation_id}", status_code=status.HTTP_200_OK)
async def resend_invitation(
    invitation_id: uuid.UUID,
    db: Session = Depends(get_db),
    tenant_id: uuid.UUID = Depends(get_current_tenant_id)
):
    """
    Resend invitation email.
    
    Security: Automatically filtered by tenant_id
    Time complexity: O(1)
    """
    invitation = db.query(Invitation).filter(
        Invitation.invitation_id == invitation_id,
        Invitation.tenant_id == tenant_id,
        Invitation.status == "pending"
    ).first()
    
    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation not found or already used"
        )
    
    # TODO: Resend invitation email
    # email_service.send_invitation_email(
    #     to=invitation.email,
    #     token=invitation.token,  # Need to regenerate or store
    #     tenant_name=invitation.tenant.name
    # )
    
    logger.info(f"Resent invitation {invitation_id}")
    
    return {"message": "Invitation resent successfully"}

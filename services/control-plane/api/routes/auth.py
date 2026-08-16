from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from datetime import datetime
import logging

from database import get_db
from models.user import User
from schemas.user import UserCreate, UserResponse, UserLogin, Token
from services.auth import (
    get_password_hash,
    authenticate_user,
    create_access_token,
    get_current_user
)

router = APIRouter(prefix="/api/auth", tags=["authentication"])
logger = logging.getLogger(__name__)


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register_user(
    user_data: UserCreate,
    invitation_token: str,
    db: Session = Depends(get_db)
):
    """
    Register a new user using invitation token.
    
    Security:
    - Password is hashed using bcrypt before storage
    - Invitation token validated and marked as used
    - Tenant_id extracted from invitation
    
    Time complexity: O(1) for database operations
    """
    from services.invitation_service import InvitationService
    
    # Validate invitation token
    invitation_service = InvitationService(db)
    invitation_data = invitation_service.validate_invitation(invitation_token, user_data.email)
    
    if not invitation_data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired invitation token"
        )
    
    # Check if email already exists
    existing_user = db.query(User).filter(
        User.email == user_data.email,
        User.tenant_id == invitation_data["tenant_id"]
    ).first()
    
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered"
        )
    
    # Hash password
    password_hash = get_password_hash(user_data.password)
    
    # Create user with tenant_id from invitation
    user = User(
        email=user_data.email,
        password_hash=password_hash,
        role=invitation_data["role"],
        tenant_id=invitation_data["tenant_id"]
    )
    
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Mark invitation as accepted
    invitation_service.accept_invitation(invitation_token, user_data.email, user.user_id)
    
    logger.info(f"Registered user: {user.user_id} ({user.email}) for tenant {user.tenant_id}")
    return user


@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """
    Authenticate user and return JWT token.
    
    Security:
    - Uses constant-time password comparison
    - Returns JWT with tenant_id claim for multi-tenant isolation
    
    Time complexity: O(1) for authentication
    """
    user = authenticate_user(db, form_data.username, form_data.password)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Update last login timestamp
    user.last_login_at = datetime.utcnow()
    db.commit()
    
    # Create access token with user_id and tenant_id claims
    access_token = create_access_token(
        data={
            "sub": str(user.user_id),
            "tenant_id": str(user.tenant_id),
            "role": user.role
        }
    )
    
    logger.info(f"User logged in: {user.user_id} ({user.email})")
    
    return Token(
        access_token=access_token,
        token_type="bearer",
        tenant_id=user.tenant_id,
        user_id=user.user_id
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user)
):
    """
    Get current authenticated user information.
    
    Security: Requires valid JWT token
    Time complexity: O(1)
    """
    return current_user


@router.post("/logout")
async def logout(
    current_user: User = Depends(get_current_user)
):
    """
    Logout current user.
    
    Note: With JWT tokens, logout is typically handled client-side
    by discarding the token. For server-side logout, implement token
    blacklisting using Redis.
    
    Time complexity: O(1)
    """
    logger.info(f"User logged out: {current_user.user_id}")
    return {"message": "Successfully logged out"}


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def signup(
    user_data: UserCreate,
    db: Session = Depends(get_db)
):
    """
    Self-service signup — creates a new tenant and admin user in one step.
    No invitation token required.
    """
    from models.tenant import Tenant
    import re

    # Check email not already taken
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered"
        )

    # Derive tenant slug from email domain
    domain = user_data.email.split("@")[-1].split(".")[0]
    slug = re.sub(r"[^a-z0-9-]", "-", domain.lower())[:50]
    # Ensure slug uniqueness
    base_slug = slug
    counter = 1
    while db.query(Tenant).filter(Tenant.slug == slug).first():
        slug = f"{base_slug}-{counter}"
        counter += 1

    tenant = Tenant(
        name=f"{domain.capitalize()} Org",
        slug=slug,
        tier="free",
        settings={}
    )
    db.add(tenant)
    db.flush()

    user = User(
        tenant_id=tenant.tenant_id,
        email=user_data.email,
        password_hash=get_password_hash(user_data.password),
        role="admin"
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    logger.info(f"Signup: created tenant {tenant.tenant_id} and user {user.user_id}")
    return user

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
import uuid
import logging
from datetime import datetime, timedelta

from database import get_db
from models.tenant import Tenant, TenantQuota, TenantSubscription
from schemas.tenant import TenantCreate, TenantResponse, TenantUpdate
from services.auth import get_current_user, require_role
from services.namespace_provisioner import NamespaceProvisioner
from services.neo4j_provisioner import Neo4jProvisioner
from config import settings
from models.user import User

router = APIRouter(prefix="/api/tenants", tags=["tenants"])
logger = logging.getLogger(__name__)


@router.post("/", response_model=TenantResponse, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    tenant_data: TenantCreate,
    db: Session = Depends(get_db)
):
    """
    Create a new tenant with isolated infrastructure.
    
    This provisions:
    - Kubernetes namespace with resource quotas
    - Neo4j database for behavior graph
    - Default quota and subscription records
    
    Security: No authentication required for tenant creation (signup flow)
    Time complexity: O(1) - constant number of operations
    """
    # Validate slug uniqueness
    existing = db.query(Tenant).filter(Tenant.slug == tenant_data.slug).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tenant with slug '{tenant_data.slug}' already exists"
        )
    
    # Create tenant record
    tenant = Tenant(
        name=tenant_data.name,
        slug=tenant_data.slug,
        tier=tenant_data.tier
    )
    db.add(tenant)
    db.flush()  # Get tenant_id without committing
    
    try:
        # Provision Kubernetes namespace
        ns_provisioner = NamespaceProvisioner(in_cluster=settings.k8s_in_cluster)
        namespace = ns_provisioner.provision_namespace(
            tenant_id=str(tenant.tenant_id),
            tenant_slug=tenant.slug,
            tier=tenant.tier
        )
        
        # Provision Neo4j database
        neo4j_provisioner = Neo4jProvisioner(
            uri=settings.neo4j_uri,
            admin_user=settings.neo4j_user,
            admin_password=settings.neo4j_password
        )
        db_name, db_user, db_password = neo4j_provisioner.provision_tenant_database(
            str(tenant.tenant_id)
        )
        
        # Initialize graph schema
        neo4j_provisioner.initialize_graph_schema(db_name, db_user, db_password)
        neo4j_provisioner.close()
        
        # Store Neo4j credentials in K8s Secret using SecretManager
        from services.secret_manager import SecretManager
        secret_manager = SecretManager()
        
        secret_name = secret_manager.create_neo4j_secret(
            tenant_id=str(tenant.tenant_id),
            namespace=namespace,
            database=db_name,
            username=db_user,
            password=db_password
        )
        
        logger.info(f"Created Neo4j secret {secret_name} for tenant {tenant.tenant_id}")
        
        # Store infrastructure details in settings (no password)
        tenant.settings = {
            "k8s_namespace": namespace,
            "neo4j_database": db_name,
            "neo4j_user": db_user,
            "neo4j_secret_name": secret_name
        }
        
        # Create default quota
        quota_limits = {
            "free": {"max_deployments": 1, "max_cpu_cores": 2, "max_memory_gb": 4, "max_storage_gb": 10, "event_retention_days": 7},
            "pro": {"max_deployments": 10, "max_cpu_cores": 10, "max_memory_gb": 20, "max_storage_gb": 100, "event_retention_days": 30},
            "enterprise": {"max_deployments": 100, "max_cpu_cores": 100, "max_memory_gb": 200, "max_storage_gb": 1000, "event_retention_days": 365}
        }
        
        limits = quota_limits.get(tenant.tier, quota_limits["free"])
        quota = TenantQuota(
            tenant_id=tenant.tenant_id,
            **limits
        )
        db.add(quota)
        
        # Create subscription
        subscription = TenantSubscription(
            tenant_id=tenant.tenant_id,
            tier=tenant.tier,
            status="active",
            billing_cycle="monthly",
            current_period_start=datetime.utcnow(),
            current_period_end=datetime.utcnow() + timedelta(days=30)
        )
        db.add(subscription)
        
        db.commit()
        db.refresh(tenant)
        
        logger.info(f"Created tenant: {tenant.tenant_id} ({tenant.slug})")
        return tenant
        
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to create tenant: {e}")
        
        # Cleanup on failure
        try:
            ns_provisioner.delete_namespace(namespace)
            neo4j_provisioner.delete_tenant_database(str(tenant.tenant_id))
            neo4j_provisioner.close()
        except:
            pass
        
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to provision tenant infrastructure: {str(e)}"
        )


@router.get("/", response_model=List[TenantResponse])
async def list_tenants(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    """
    List all tenants (admin only).
    
    Security: Requires admin role
    Time complexity: O(n) where n is number of tenants (limited by pagination)
    """
    tenants = db.query(Tenant).offset(skip).limit(limit).all()
    return tenants


@router.get("/{tenant_id}", response_model=TenantResponse)
async def get_tenant(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get tenant details.
    
    Security: Users can only access their own tenant unless admin
    Time complexity: O(1) - indexed lookup
    """
    tenant = db.query(Tenant).filter(Tenant.tenant_id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    
    # Verify access
    if current_user.tenant_id != tenant_id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    return tenant


@router.patch("/{tenant_id}", response_model=TenantResponse)
async def update_tenant(
    tenant_id: uuid.UUID,
    tenant_update: TenantUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update tenant settings.
    
    Security: Users can only update their own tenant unless admin
    Time complexity: O(1)
    """
    tenant = db.query(Tenant).filter(Tenant.tenant_id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    
    # Verify access
    if current_user.tenant_id != tenant_id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    
    # Update fields
    if tenant_update.name is not None:
        tenant.name = tenant_update.name
    if tenant_update.settings is not None:
        tenant.settings.update(tenant_update.settings)
    
    db.commit()
    db.refresh(tenant)
    
    logger.info(f"Updated tenant: {tenant_id}")
    return tenant


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("admin"))
):
    """
    Delete tenant and all associated resources.
    
    Security: Admin only
    Time complexity: O(1) for database, O(n) for K8s resource cleanup
    """
    tenant = db.query(Tenant).filter(Tenant.tenant_id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    
    try:
        # Delete Kubernetes namespace
        ns_provisioner = NamespaceProvisioner(in_cluster=settings.k8s_in_cluster)
        namespace = tenant.settings.get("k8s_namespace")
        if namespace:
            ns_provisioner.delete_namespace(namespace)
        
        # Delete Neo4j database
        neo4j_provisioner = Neo4jProvisioner(
            uri=settings.neo4j_uri,
            admin_user=settings.neo4j_user,
            admin_password=settings.neo4j_password
        )
        neo4j_provisioner.delete_tenant_database(str(tenant_id))
        neo4j_provisioner.close()
        
        # Delete tenant record (cascades to users, deployments, incidents)
        db.delete(tenant)
        db.commit()
        
        logger.info(f"Deleted tenant: {tenant_id}")
        
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to delete tenant: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete tenant: {str(e)}"
        )

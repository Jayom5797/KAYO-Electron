from kubernetes import client, config as k8s_config
from kubernetes.client.rest import ApiException
import base64
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)


class SecretManager:
    """
    Manages Kubernetes Secrets for sensitive data.
    
    Security:
    - Stores Neo4j passwords in K8s Secrets instead of database
    - Encrypts secrets at rest (K8s encryption)
    - Namespace-scoped secrets for tenant isolation
    
    Performance:
    - O(1) secret creation and retrieval
    - Cached K8s client connection
    
    Time complexity: O(1) for all operations
    """
    
    def __init__(self, in_cluster: bool = False):
        """
        Initialize Kubernetes client.
        
        Args:
            in_cluster: True if running inside K8s cluster
        """
        if in_cluster:
            k8s_config.load_incluster_config()
        else:
            k8s_config.load_kube_config()
        
        self.core_v1 = client.CoreV1Api()
    
    def create_neo4j_secret(
        self,
        tenant_id: str,
        namespace: str,
        database_name: str,
        username: str,
        password: str
    ) -> str:
        """
        Create K8s Secret for Neo4j credentials.
        
        Args:
            tenant_id: Tenant UUID
            namespace: K8s namespace
            database_name: Neo4j database name
            username: Neo4j username
            password: Neo4j password
        
        Returns:
            Secret name
        
        Security:
        - Password never stored in PostgreSQL
        - Secret scoped to tenant namespace
        - Base64 encoded (K8s requirement)
        
        Time complexity: O(1)
        """
        secret_name = f"neo4j-{tenant_id}"
        
        # Create secret data
        secret_data = {
            "database": base64.b64encode(database_name.encode()).decode(),
            "username": base64.b64encode(username.encode()).decode(),
            "password": base64.b64encode(password.encode()).decode(),
            "uri": base64.b64encode(f"bolt://neo4j:7687".encode()).decode()
        }
        
        # Create secret metadata
        metadata = client.V1ObjectMeta(
            name=secret_name,
            namespace=namespace,
            labels={
                "kayo.io/tenant-id": tenant_id,
                "kayo.io/secret-type": "neo4j-credentials"
            }
        )
        
        # Create secret object
        secret = client.V1Secret(
            metadata=metadata,
            type="Opaque",
            data=secret_data
        )
        
        try:
            self.core_v1.create_namespaced_secret(namespace, secret)
            logger.info(f"Created Neo4j secret for tenant {tenant_id}")
            return secret_name
        
        except ApiException as e:
            if e.status == 409:
                # Secret already exists, update it
                self.core_v1.replace_namespaced_secret(secret_name, namespace, secret)
                logger.info(f"Updated Neo4j secret for tenant {tenant_id}")
                return secret_name
            else:
                logger.error(f"Failed to create secret: {e}")
                raise
    
    def get_neo4j_credentials(
        self,
        tenant_id: str,
        namespace: str
    ) -> Optional[Dict[str, str]]:
        """
        Retrieve Neo4j credentials from K8s Secret.
        
        Args:
            tenant_id: Tenant UUID
            namespace: K8s namespace
        
        Returns:
            Dictionary with database, username, password, uri
        
        Security: Only accessible within same namespace
        Time complexity: O(1)
        """
        secret_name = f"neo4j-{tenant_id}"
        
        try:
            secret = self.core_v1.read_namespaced_secret(secret_name, namespace)
            
            # Decode secret data
            credentials = {
                "database": base64.b64decode(secret.data["database"]).decode(),
                "username": base64.b64decode(secret.data["username"]).decode(),
                "password": base64.b64decode(secret.data["password"]).decode(),
                "uri": base64.b64decode(secret.data["uri"]).decode()
            }
            
            return credentials
        
        except ApiException as e:
            if e.status == 404:
                logger.warning(f"Secret not found for tenant {tenant_id}")
                return None
            else:
                logger.error(f"Failed to read secret: {e}")
                raise
    
    def delete_neo4j_secret(
        self,
        tenant_id: str,
        namespace: str
    ):
        """
        Delete Neo4j secret.
        
        Args:
            tenant_id: Tenant UUID
            namespace: K8s namespace
        
        Time complexity: O(1)
        """
        secret_name = f"neo4j-{tenant_id}"
        
        try:
            self.core_v1.delete_namespaced_secret(secret_name, namespace)
            logger.info(f"Deleted Neo4j secret for tenant {tenant_id}")
        
        except ApiException as e:
            if e.status != 404:
                logger.error(f"Failed to delete secret: {e}")
                raise
    
    def rotate_neo4j_password(
        self,
        tenant_id: str,
        namespace: str,
        new_password: str
    ):
        """
        Rotate Neo4j password.
        
        Args:
            tenant_id: Tenant UUID
            namespace: K8s namespace
            new_password: New password
        
        Security: Implements password rotation for compliance
        Time complexity: O(1)
        """
        # Get existing credentials
        credentials = self.get_neo4j_credentials(tenant_id, namespace)
        
        if not credentials:
            raise ValueError(f"No credentials found for tenant {tenant_id}")
        
        # Update password in secret
        self.create_neo4j_secret(
            tenant_id=tenant_id,
            namespace=namespace,
            database_name=credentials["database"],
            username=credentials["username"],
            password=new_password
        )
        
        logger.info(f"Rotated Neo4j password for tenant {tenant_id}")

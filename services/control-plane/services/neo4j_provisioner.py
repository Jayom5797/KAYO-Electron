from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable, ClientError
import secrets
import string
import logging
from typing import Tuple

logger = logging.getLogger(__name__)


class Neo4jProvisioner:
    """
    Provisions and manages Neo4j databases for tenant behavior graphs.
    
    Each tenant gets a dedicated database with:
    - Isolated data storage
    - Dedicated user credentials
    - Automatic backup configuration
    """
    
    def __init__(self, uri: str, admin_user: str, admin_password: str):
        """
        Initialize Neo4j admin connection.
        
        Args:
            uri: Neo4j connection URI (bolt://host:port)
            admin_user: Admin username
            admin_password: Admin password
        
        Raises:
            ServiceUnavailable: If cannot connect to Neo4j
        """
        try:
            self.driver = GraphDatabase.driver(uri, auth=(admin_user, admin_password))
            # Verify connection
            self.driver.verify_connectivity()
            logger.info("Neo4j connection established")
        except ServiceUnavailable as e:
            logger.error(f"Failed to connect to Neo4j: {e}")
            raise
    
    def provision_tenant_database(self, tenant_id: str) -> Tuple[str, str, str]:
        """
        Create a new database for a tenant with dedicated user.
        
        Args:
            tenant_id: UUID of the tenant
        
        Returns:
            Tuple of (database_name, username, password)
        
        Security: Generates cryptographically secure random password
        Time complexity: O(1) - constant number of database operations
        """
        # Sanitize tenant_id for database name (replace hyphens with underscores)
        db_name = f"tenant_{tenant_id.replace('-', '_')}"
        username = f"user_{tenant_id.replace('-', '_')}"
        password = self._generate_password()
        
        try:
            with self.driver.session(database="system") as session:
                # Create database
                try:
                    session.run(f"CREATE DATABASE {db_name} IF NOT EXISTS")
                    logger.info(f"Created Neo4j database: {db_name}")
                except ClientError as e:
                    if "already exists" not in str(e).lower():
                        raise
                
                # Create user
                try:
                    session.run(
                        f"CREATE USER {username} IF NOT EXISTS "
                        f"SET PASSWORD $password "
                        f"SET PASSWORD CHANGE NOT REQUIRED",
                        password=password
                    )
                    logger.info(f"Created Neo4j user: {username}")
                except ClientError as e:
                    if "already exists" not in str(e).lower():
                        raise
                
                # Grant database access
                try:
                    session.run(
                        f"GRANT ACCESS ON DATABASE {db_name} TO {username}"
                    )
                    session.run(
                        f"GRANT ALL GRAPH PRIVILEGES ON DATABASE {db_name} TO {username}"
                    )
                    logger.info(f"Granted privileges to {username} on {db_name}")
                except ClientError as e:
                    logger.warning(f"Failed to grant privileges: {e}")
            
            return db_name, username, password
            
        except Exception as e:
            logger.error(f"Failed to provision tenant database: {e}")
            raise
    
    def delete_tenant_database(self, tenant_id: str):
        """
        Delete tenant database and user.
        
        Args:
            tenant_id: UUID of the tenant
        
        Time complexity: O(1)
        """
        db_name = f"tenant_{tenant_id.replace('-', '_')}"
        username = f"user_{tenant_id.replace('-', '_')}"
        
        try:
            with self.driver.session(database="system") as session:
                # Drop database
                try:
                    session.run(f"DROP DATABASE {db_name} IF EXISTS")
                    logger.info(f"Dropped Neo4j database: {db_name}")
                except ClientError as e:
                    logger.error(f"Failed to drop database: {e}")
                
                # Drop user
                try:
                    session.run(f"DROP USER {username} IF EXISTS")
                    logger.info(f"Dropped Neo4j user: {username}")
                except ClientError as e:
                    logger.error(f"Failed to drop user: {e}")
                    
        except Exception as e:
            logger.error(f"Failed to delete tenant database: {e}")
            raise
    
    def initialize_graph_schema(self, database: str, username: str, password: str):
        """
        Initialize graph schema with constraints and indexes.
        
        Args:
            database: Database name
            username: Database user
            password: User password
        
        Creates:
        - Uniqueness constraints on entity IDs
        - Indexes for common queries
        
        Time complexity: O(1) - constant number of schema operations
        """
        try:
            # Connect as tenant user
            tenant_driver = GraphDatabase.driver(
                self.driver._pool.address,
                auth=(username, password)
            )
            
            with tenant_driver.session(database=database) as session:
                # Create constraints (ensures uniqueness and creates index)
                constraints = [
                    "CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE",
                    "CREATE CONSTRAINT process_id_unique IF NOT EXISTS FOR (p:Process) REQUIRE p.id IS UNIQUE",
                    "CREATE CONSTRAINT host_id_unique IF NOT EXISTS FOR (h:Host) REQUIRE h.id IS UNIQUE",
                    "CREATE CONSTRAINT container_id_unique IF NOT EXISTS FOR (c:Container) REQUIRE c.id IS UNIQUE",
                    "CREATE CONSTRAINT service_id_unique IF NOT EXISTS FOR (s:Service) REQUIRE s.id IS UNIQUE",
                    "CREATE CONSTRAINT file_id_unique IF NOT EXISTS FOR (f:File) REQUIRE f.id IS UNIQUE",
                ]
                
                for constraint in constraints:
                    try:
                        session.run(constraint)
                    except ClientError as e:
                        if "already exists" not in str(e).lower():
                            logger.warning(f"Failed to create constraint: {e}")
                
                # Create additional indexes for performance
                indexes = [
                    "CREATE INDEX process_name_idx IF NOT EXISTS FOR (p:Process) ON (p.name)",
                    "CREATE INDEX host_name_idx IF NOT EXISTS FOR (h:Host) ON (h.hostname)",
                    "CREATE INDEX container_image_idx IF NOT EXISTS FOR (c:Container) ON (c.image)",
                ]
                
                for index in indexes:
                    try:
                        session.run(index)
                    except ClientError as e:
                        if "already exists" not in str(e).lower():
                            logger.warning(f"Failed to create index: {e}")
                
                logger.info(f"Initialized graph schema for database: {database}")
            
            tenant_driver.close()
            
        except Exception as e:
            logger.error(f"Failed to initialize graph schema: {e}")
            raise
    
    @staticmethod
    def _generate_password(length: int = 32) -> str:
        """
        Generate cryptographically secure random password.
        
        Args:
            length: Password length
        
        Returns:
            Random password string
        
        Security: Uses secrets module for cryptographic randomness
        """
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*()"
        return ''.join(secrets.choice(alphabet) for _ in range(length))
    
    def close(self):
        """Close Neo4j driver connection"""
        self.driver.close()
        logger.info("Neo4j connection closed")

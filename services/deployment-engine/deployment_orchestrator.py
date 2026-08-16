from kubernetes import client, config as k8s_config
from kubernetes.client.rest import ApiException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from kafka import KafkaConsumer
import logging
import json
from typing import Dict, Optional
import time

from config import settings
from build_service import BuildService
from manifest_generator import ManifestGenerator

logging.basicConfig(
    level=settings.log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DeploymentOrchestrator:
    """
    Orchestrates application deployments with integrated monitoring.
    
    Architecture:
    - Consumes deployment requests from Kafka
    - Builds container images using Kaniko
    - Generates K8s manifests with Vector sidecar
    - Deploys to tenant-isolated namespaces
    - Updates deployment status in PostgreSQL
    
    Security:
    - Tenant isolation via namespaces
    - Restricted service accounts
    - Non-root containers
    - Network policies enforced
    
    Performance:
    - Parallel builds and deployments
    - Build caching enabled
    - Resource limits per tier
    
    Time complexity: O(n) where n is deployment time
    """
    
    def __init__(self):
        """Initialize orchestrator with K8s and database connections"""
        # Kubernetes client
        if settings.k8s_in_cluster:
            k8s_config.load_incluster_config()
        else:
            k8s_config.load_kube_config()
        
        self.apps_v1 = client.AppsV1Api()
        self.core_v1 = client.CoreV1Api()
        self.networking_v1 = client.NetworkingV1Api()
        
        # PostgreSQL for deployment metadata
        engine = create_engine(settings.database_url)
        Session = sessionmaker(bind=engine)
        self.db_session = Session()
        
        # Kafka consumer for deployment requests
        self.consumer = KafkaConsumer(
            'deployment.requests',
            bootstrap_servers=settings.kafka_bootstrap_servers,
            group_id='deployment-orchestrator',
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset='latest',
            enable_auto_commit=True
        )
        
        # Services
        self.build_service = BuildService()
        self.manifest_generator = ManifestGenerator()
        
        # Metrics
        self.deployments_processed = 0
        self.deployments_succeeded = 0
        self.deployments_failed = 0
        
        logger.info("Initialized DeploymentOrchestrator")
    
    def run(self):
        """
        Main event loop - consume deployment requests.
        
        Time complexity: O(∞) - runs indefinitely
        """
        logger.info("Starting deployment orchestrator loop")
        
        try:
            for message in self.consumer:
                try:
                    request = message.value
                    self._process_deployment_request(request)
                    self.deployments_processed += 1
                    
                    if self.deployments_processed % 10 == 0:
                        logger.info(
                            f"Processed {self.deployments_processed} deployments: "
                            f"{self.deployments_succeeded} succeeded, "
                            f"{self.deployments_failed} failed"
                        )
                
                except Exception as e:
                    logger.error(f"Failed to process deployment request: {e}", exc_info=True)
                    self.deployments_failed += 1
        
        except KeyboardInterrupt:
            logger.info("Received shutdown signal")
        finally:
            self._cleanup()
    
    def _process_deployment_request(self, request: Dict):
        """
        Process single deployment request.
        
        Args:
            request: Deployment request with tenant_id, deployment_id, etc.
        
        Security: Validates tenant_id, enforces namespace isolation
        Time complexity: O(n) where n is build + deploy time
        """
        deployment_id = request.get('deployment_id')
        tenant_id = request.get('tenant_id')
        
        if not deployment_id or not tenant_id:
            logger.error("Invalid deployment request: missing deployment_id or tenant_id")
            return
        
        logger.info(f"Processing deployment {deployment_id} for tenant {tenant_id}")
        
        try:
            # Update status to building
            self._update_deployment_status(deployment_id, 'building')
            
            # Get deployment details from database
            deployment = self._get_deployment(deployment_id, tenant_id)
            if not deployment:
                logger.error(f"Deployment {deployment_id} not found")
                return
            
            # Build container image
            image_tag = f"{settings.registry_url}/{tenant_id}/{deployment.app_name}:{deployment_id[:8]}"
            
            build_result = self.build_service.build_image(
                deployment_id=deployment_id,
                tenant_id=tenant_id,
                git_repo=deployment.git_repo,
                git_branch=deployment.git_branch,
                image_tag=image_tag
            )
            
            if build_result['status'] != 'success':
                self._update_deployment_status(
                    deployment_id,
                    'build_failed',
                    error=build_result.get('error')
                )
                self.deployments_failed += 1
                return
            
            # Update status to deploying
            self._update_deployment_status(deployment_id, 'deploying')
            
            # Deploy to Kubernetes
            deploy_result = self._deploy_to_kubernetes(
                deployment_id=deployment_id,
                tenant_id=tenant_id,
                app_name=deployment.app_name,
                image_tag=image_tag,
                env_vars=deployment.env_vars or {}
            )
            
            if deploy_result['status'] == 'success':
                self._update_deployment_status(
                    deployment_id,
                    'running',
                    endpoint=deploy_result.get('endpoint')
                )
                self.deployments_succeeded += 1
                logger.info(f"Successfully deployed {deployment_id}")
            else:
                self._update_deployment_status(
                    deployment_id,
                    'deploy_failed',
                    error=deploy_result.get('error')
                )
                self.deployments_failed += 1
        
        except Exception as e:
            logger.error(f"Failed to process deployment {deployment_id}: {e}", exc_info=True)
            self._update_deployment_status(deployment_id, 'failed', error=str(e))
            self.deployments_failed += 1
    
    def _deploy_to_kubernetes(
        self,
        deployment_id: str,
        tenant_id: str,
        app_name: str,
        image_tag: str,
        env_vars: Dict[str, str]
    ) -> Dict[str, any]:
        """
        Deploy application to Kubernetes with monitoring sidecar.
        
        Args:
            deployment_id: Deployment UUID
            tenant_id: Tenant UUID
            app_name: Application name
            image_tag: Container image tag
            env_vars: Environment variables
        
        Returns:
            Deployment result with status and endpoint
        
        Security: Deploys to tenant namespace with restricted service account
        Time complexity: O(1) for manifest creation, O(n) for K8s API calls
        """
        namespace = f"{settings.k8s_namespace_prefix}{tenant_id}"
        
        try:
            # Create Vector ConfigMap
            vector_config = self.manifest_generator.generate_vector_config(
                deployment_id, tenant_id
            )
            
            config_map = client.V1ConfigMap(
                metadata=client.V1ObjectMeta(
                    name=f"vector-config-{deployment_id}",
                    namespace=namespace
                ),
                data={"vector.toml": vector_config}
            )
            
            self.core_v1.create_namespaced_config_map(namespace, config_map)
            logger.info(f"Created Vector ConfigMap for deployment {deployment_id}")
            
            # Generate and create Deployment
            deployment = self.manifest_generator.generate_deployment(
                deployment_id=deployment_id,
                tenant_id=tenant_id,
                app_name=app_name,
                image_tag=image_tag,
                env_vars=env_vars,
                replicas=1,
                resource_tier="basic"
            )
            
            self.apps_v1.create_namespaced_deployment(namespace, deployment)
            logger.info(f"Created Deployment for {deployment_id}")
            
            # Generate and create Service
            service = self.manifest_generator.generate_service(
                deployment_id=deployment_id,
                tenant_id=tenant_id,
                app_name=app_name,
                port=8080
            )
            
            self.core_v1.create_namespaced_service(namespace, service)
            logger.info(f"Created Service for {deployment_id}")
            
            # Generate and create Ingress
            hostname = f"{app_name}-{deployment_id[:8]}.{tenant_id}.kayo.app"
            
            ingress = self.manifest_generator.generate_ingress(
                deployment_id=deployment_id,
                tenant_id=tenant_id,
                app_name=app_name,
                hostname=hostname
            )
            
            self.networking_v1.create_namespaced_ingress(namespace, ingress)
            logger.info(f"Created Ingress for {deployment_id}")
            
            # Wait for deployment to be ready
            ready = self._wait_for_deployment_ready(
                f"{app_name}-{deployment_id[:8]}",
                namespace,
                timeout=300
            )
            
            if ready:
                return {
                    'status': 'success',
                    'endpoint': f"https://{hostname}"
                }
            else:
                return {
                    'status': 'timeout',
                    'error': 'Deployment did not become ready within timeout'
                }
        
        except ApiException as e:
            logger.error(f"Kubernetes API error: {e}")
            return {
                'status': 'failed',
                'error': str(e)
            }
    
    def _wait_for_deployment_ready(
        self,
        deployment_name: str,
        namespace: str,
        timeout: int = 300,
        poll_interval: int = 5
    ) -> bool:
        """
        Wait for deployment to be ready.
        
        Args:
            deployment_name: Deployment name
            namespace: K8s namespace
            timeout: Timeout in seconds
            poll_interval: Polling interval in seconds
        
        Returns:
            True if ready, False if timeout
        
        Time complexity: O(n) where n is timeout duration
        """
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            try:
                deployment = self.apps_v1.read_namespaced_deployment_status(
                    deployment_name, namespace
                )
                
                if deployment.status.ready_replicas and \
                   deployment.status.ready_replicas >= deployment.spec.replicas:
                    logger.info(f"Deployment {deployment_name} is ready")
                    return True
                
                time.sleep(poll_interval)
            
            except ApiException as e:
                logger.error(f"Failed to check deployment status: {e}")
                return False
        
        logger.warning(f"Deployment {deployment_name} timed out")
        return False
    
    def _get_deployment(self, deployment_id: str, tenant_id: str):
        """
        Get deployment from database.
        
        Args:
            deployment_id: Deployment UUID
            tenant_id: Tenant UUID
        
        Returns:
            Deployment object or None
        
        Security: Filters by tenant_id for isolation
        Time complexity: O(1) - indexed lookup
        """
        try:
            import sys
            sys.path.append('../../services/control-plane')
            from models.deployment import Deployment
            
            deployment = self.db_session.query(Deployment).filter(
                Deployment.deployment_id == deployment_id,
                Deployment.tenant_id == tenant_id
            ).first()
            
            return deployment
        
        except Exception as e:
            logger.error(f"Failed to get deployment: {e}")
            return None
    
    def _update_deployment_status(
        self,
        deployment_id: str,
        status: str,
        error: Optional[str] = None,
        endpoint: Optional[str] = None
    ):
        """
        Update deployment status in database.
        
        Args:
            deployment_id: Deployment UUID
            status: New status
            error: Error message if failed
            endpoint: Deployment endpoint if successful
        
        Security: Uses ORM to prevent SQL injection
        Time complexity: O(1)
        """
        try:
            import sys
            sys.path.append('../../services/control-plane')
            from models.deployment import Deployment
            
            deployment = self.db_session.query(Deployment).filter(
                Deployment.deployment_id == deployment_id
            ).first()
            
            if deployment:
                deployment.status = status
                if error:
                    deployment.error_message = error
                if endpoint:
                    deployment.endpoint = endpoint
                
                self.db_session.commit()
                logger.info(f"Updated deployment {deployment_id} status to {status}")
        
        except Exception as e:
            self.db_session.rollback()
            logger.error(f"Failed to update deployment status: {e}")
    
    def _cleanup(self):
        """Cleanup connections on shutdown"""
        logger.info("Cleaning up connections")
        self.consumer.close()
        self.db_session.close()
        logger.info("Cleanup complete")


def main():
    """Main entry point"""
    orchestrator = DeploymentOrchestrator()
    orchestrator.run()


if __name__ == "__main__":
    main()

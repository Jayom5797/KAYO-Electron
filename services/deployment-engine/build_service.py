from kubernetes import client, config as k8s_config
from kubernetes.client.rest import ApiException
import logging
import base64
import json
from typing import Dict, Optional
import time

from config import settings

logger = logging.getLogger(__name__)


class BuildService:
    """
    Builds container images from Git repositories using Kubernetes Jobs.
    
    Architecture:
    - Creates ephemeral K8s Job for each build
    - Uses Kaniko for rootless container builds
    - Pushes images to container registry
    - Cleans up build resources after completion
    
    Performance:
    - Parallel builds (one Job per deployment)
    - Build timeout: 10 minutes (configurable)
    - Resource limits enforced per build
    
    Time complexity: O(1) for job creation, O(n) for build execution where n is codebase size
    """
    
    def __init__(self):
        """Initialize Kubernetes client"""
        if settings.k8s_in_cluster:
            k8s_config.load_incluster_config()
        else:
            k8s_config.load_kube_config()
        
        self.batch_v1 = client.BatchV1Api()
        self.core_v1 = client.CoreV1Api()
    
    def build_image(
        self,
        deployment_id: str,
        tenant_id: str,
        git_repo: str,
        git_branch: str,
        image_tag: str
    ) -> Dict[str, any]:
        """
        Build container image from Git repository.
        
        Args:
            deployment_id: Deployment UUID
            tenant_id: Tenant UUID
            git_repo: Git repository URL
            git_branch: Git branch to build
            image_tag: Full image tag (registry/repo:tag)
        
        Returns:
            Build result with status and image tag
        
        Security: Runs in isolated namespace, rootless build
        Time complexity: O(n) where n is build time
        """
        build_namespace = f"{settings.k8s_namespace_prefix}{tenant_id}"
        job_name = f"build-{deployment_id}"[:63]  # K8s name limit
        
        try:
            # Create registry secret if credentials provided
            if settings.registry_username and settings.registry_password:
                self._create_registry_secret(build_namespace, tenant_id)
            
            # Create build Job
            job = self._create_build_job(
                job_name,
                build_namespace,
                git_repo,
                git_branch,
                image_tag,
                tenant_id
            )
            
            self.batch_v1.create_namespaced_job(
                namespace=build_namespace,
                body=job
            )
            
            logger.info(f"Created build job {job_name} in namespace {build_namespace}")
            
            # Wait for build completion
            result = self._wait_for_build(job_name, build_namespace)
            
            # Cleanup job
            self._cleanup_build_job(job_name, build_namespace)
            
            return result
        
        except ApiException as e:
            logger.error(f"Failed to create build job: {e}")
            return {
                'status': 'failed',
                'error': str(e),
                'image_tag': None
            }
    
    def _create_build_job(
        self,
        job_name: str,
        namespace: str,
        git_repo: str,
        git_branch: str,
        image_tag: str,
        tenant_id: str
    ) -> client.V1Job:
        """
        Create Kubernetes Job for building container image.
        
        Uses Kaniko for rootless, daemonless container builds.
        
        Args:
            job_name: Job name
            namespace: K8s namespace
            git_repo: Git repository URL
            git_branch: Git branch
            image_tag: Target image tag
            tenant_id: Tenant UUID
        
        Returns:
            V1Job object
        
        Security: Runs as non-root, no Docker daemon required
        Time complexity: O(1) - job creation
        """
        # Kaniko executor container
        container = client.V1Container(
            name="kaniko",
            image="gcr.io/kaniko-project/executor:v1.19.0",
            args=[
                f"--context=git://{git_repo}",
                f"--context-sub-path=",
                f"--destination={image_tag}",
                f"--cache=true",
                f"--cache-ttl=24h",
                "--compressed-caching=false",
                "--snapshot-mode=redo",
                "--use-new-run"
            ],
            env=[
                client.V1EnvVar(name="GIT_BRANCH", value=git_branch)
            ],
            resources=client.V1ResourceRequirements(
                limits={
                    "memory": settings.build_memory_limit,
                    "cpu": settings.build_cpu_limit
                },
                requests={
                    "memory": "512Mi",
                    "cpu": "500m"
                }
            ),
            volume_mounts=[
                client.V1VolumeMount(
                    name="docker-config",
                    mount_path="/kaniko/.docker"
                )
            ] if settings.registry_username else []
        )
        
        # Pod template
        pod_template = client.V1PodTemplateSpec(
            metadata=client.V1ObjectMeta(
                labels={
                    "app": "kayo-build",
                    "deployment-id": deployment_id[:63],
                    "tenant-id": tenant_id
                }
            ),
            spec=client.V1PodSpec(
                restart_policy="Never",
                containers=[container],
                volumes=[
                    client.V1Volume(
                        name="docker-config",
                        secret=client.V1SecretVolumeSource(
                            secret_name=f"registry-secret-{tenant_id}"
                        )
                    )
                ] if settings.registry_username else []
            )
        )
        
        # Job spec
        job_spec = client.V1JobSpec(
            template=pod_template,
            backoff_limit=2,
            active_deadline_seconds=settings.build_timeout,
            ttl_seconds_after_finished=3600  # Cleanup after 1 hour
        )
        
        # Job
        job = client.V1Job(
            api_version="batch/v1",
            kind="Job",
            metadata=client.V1ObjectMeta(
                name=job_name,
                labels={
                    "app": "kayo-build",
                    "tenant-id": tenant_id
                }
            ),
            spec=job_spec
        )
        
        return job
    
    def _create_registry_secret(self, namespace: str, tenant_id: str):
        """
        Create Docker registry secret for image push.
        
        Args:
            namespace: K8s namespace
            tenant_id: Tenant UUID
        
        Security: Credentials stored in K8s Secret
        Time complexity: O(1)
        """
        secret_name = f"registry-secret-{tenant_id}"
        
        # Check if secret already exists
        try:
            self.core_v1.read_namespaced_secret(secret_name, namespace)
            return  # Secret exists
        except ApiException:
            pass  # Secret doesn't exist, create it
        
        # Create Docker config JSON
        auth_string = f"{settings.registry_username}:{settings.registry_password}"
        auth_encoded = base64.b64encode(auth_string.encode()).decode()
        
        docker_config = {
            "auths": {
                settings.registry_url: {
                    "auth": auth_encoded
                }
            }
        }
        
        secret = client.V1Secret(
            metadata=client.V1ObjectMeta(name=secret_name),
            type="kubernetes.io/dockerconfigjson",
            data={
                ".dockerconfigjson": base64.b64encode(
                    json.dumps(docker_config).encode()
                ).decode()
            }
        )
        
        try:
            self.core_v1.create_namespaced_secret(namespace, secret)
            logger.info(f"Created registry secret in namespace {namespace}")
        except ApiException as e:
            logger.error(f"Failed to create registry secret: {e}")
    
    def _wait_for_build(
        self,
        job_name: str,
        namespace: str,
        poll_interval: int = 5
    ) -> Dict[str, any]:
        """
        Wait for build job to complete.
        
        Args:
            job_name: Job name
            namespace: K8s namespace
            poll_interval: Polling interval in seconds
        
        Returns:
            Build result dictionary
        
        Time complexity: O(n) where n is build duration
        """
        start_time = time.time()
        
        while True:
            try:
                job = self.batch_v1.read_namespaced_job_status(job_name, namespace)
                
                # Check if job completed
                if job.status.succeeded:
                    elapsed = time.time() - start_time
                    logger.info(f"Build job {job_name} succeeded in {elapsed:.1f}s")
                    return {
                        'status': 'success',
                        'duration': elapsed,
                        'error': None
                    }
                
                # Check if job failed
                if job.status.failed:
                    # Get pod logs for error details
                    error_logs = self._get_build_logs(job_name, namespace)
                    logger.error(f"Build job {job_name} failed: {error_logs}")
                    return {
                        'status': 'failed',
                        'error': error_logs,
                        'duration': time.time() - start_time
                    }
                
                # Check timeout
                if time.time() - start_time > settings.build_timeout:
                    logger.error(f"Build job {job_name} timed out")
                    return {
                        'status': 'timeout',
                        'error': 'Build exceeded timeout',
                        'duration': settings.build_timeout
                    }
                
                # Continue waiting
                time.sleep(poll_interval)
            
            except ApiException as e:
                logger.error(f"Failed to check job status: {e}")
                return {
                    'status': 'error',
                    'error': str(e),
                    'duration': time.time() - start_time
                }
    
    def _get_build_logs(self, job_name: str, namespace: str) -> str:
        """
        Get logs from build pod.
        
        Args:
            job_name: Job name
            namespace: K8s namespace
        
        Returns:
            Pod logs (last 50 lines)
        
        Time complexity: O(1)
        """
        try:
            # Find pod for job
            pods = self.core_v1.list_namespaced_pod(
                namespace,
                label_selector=f"job-name={job_name}"
            )
            
            if not pods.items:
                return "No pods found for job"
            
            pod_name = pods.items[0].metadata.name
            
            # Get logs
            logs = self.core_v1.read_namespaced_pod_log(
                pod_name,
                namespace,
                tail_lines=50
            )
            
            return logs
        
        except ApiException as e:
            return f"Failed to get logs: {e}"
    
    def _cleanup_build_job(self, job_name: str, namespace: str):
        """
        Delete build job and associated pods.
        
        Args:
            job_name: Job name
            namespace: K8s namespace
        
        Time complexity: O(1)
        """
        try:
            self.batch_v1.delete_namespaced_job(
                job_name,
                namespace,
                propagation_policy='Background'
            )
            logger.info(f"Deleted build job {job_name}")
        except ApiException as e:
            logger.warning(f"Failed to delete build job: {e}")

from kubernetes import client
from typing import Dict, List, Optional
import yaml
import logging

from config import settings

logger = logging.getLogger(__name__)


class ManifestGenerator:
    """
    Generates Kubernetes manifests for application deployments.
    
    Architecture:
    - Creates Deployment with application container + Vector sidecar
    - Creates Service for internal networking
    - Creates Ingress for external access
    - Injects tenant_id labels for isolation
    - Configures resource limits per tenant tier
    
    Security:
    - Runs as non-root user
    - Read-only root filesystem
    - Drops all capabilities
    - Network policies enforced at namespace level
    
    Time complexity: O(1) - manifest generation
    """
    
    def generate_deployment(
        self,
        deployment_id: str,
        tenant_id: str,
        app_name: str,
        image_tag: str,
        env_vars: Dict[str, str],
        replicas: int = 1,
        resource_tier: str = "basic"
    ) -> client.V1Deployment:
        """
        Generate Deployment manifest with monitoring sidecar.
        
        Args:
            deployment_id: Deployment UUID
            tenant_id: Tenant UUID
            app_name: Application name
            image_tag: Container image tag
            env_vars: Environment variables
            replicas: Number of replicas
            resource_tier: Resource tier (basic, standard, premium)
        
        Returns:
            V1Deployment object
        
        Security: Non-root, read-only filesystem, capability drop
        Time complexity: O(1)
        """
        namespace = f"{settings.k8s_namespace_prefix}{tenant_id}"
        
        # Resource limits by tier
        resource_limits = self._get_resource_limits(resource_tier)
        
        # Application container
        app_container = client.V1Container(
            name="app",
            image=image_tag,
            ports=[client.V1ContainerPort(container_port=8080, name="http")],
            env=[
                client.V1EnvVar(name=k, value=v)
                for k, v in env_vars.items()
            ] + [
                # Inject tenant context
                client.V1EnvVar(name="KAYO_TENANT_ID", value=tenant_id),
                client.V1EnvVar(name="KAYO_DEPLOYMENT_ID", value=deployment_id)
            ],
            resources=client.V1ResourceRequirements(
                limits=resource_limits['limits'],
                requests=resource_limits['requests']
            ),
            security_context=client.V1SecurityContext(
                run_as_non_root=True,
                run_as_user=1000,
                read_only_root_filesystem=True,
                allow_privilege_escalation=False,
                capabilities=client.V1Capabilities(drop=["ALL"])
            ),
            volume_mounts=[
                client.V1VolumeMount(name="tmp", mount_path="/tmp"),
                client.V1VolumeMount(name="logs", mount_path="/var/log/app")
            ]
        )
        
        # Vector sidecar for telemetry collection
        vector_sidecar = self._create_vector_sidecar(tenant_id, deployment_id)
        
        # Pod template
        pod_template = client.V1PodTemplateSpec(
            metadata=client.V1ObjectMeta(
                labels={
                    "app": app_name,
                    "deployment-id": deployment_id[:63],
                    "tenant-id": tenant_id,
                    "kayo.io/monitored": "true"
                },
                annotations={
                    "kayo.io/tenant-id": tenant_id,
                    "kayo.io/deployment-id": deployment_id
                }
            ),
            spec=client.V1PodSpec(
                service_account_name=f"kayo-app-{tenant_id}",
                automount_service_account_token=False,
                containers=[app_container, vector_sidecar],
                volumes=[
                    client.V1Volume(
                        name="tmp",
                        empty_dir=client.V1EmptyDirVolumeSource()
                    ),
                    client.V1Volume(
                        name="logs",
                        empty_dir=client.V1EmptyDirVolumeSource()
                    ),
                    client.V1Volume(
                        name="vector-config",
                        config_map=client.V1ConfigMapVolumeSource(
                            name=f"vector-config-{deployment_id}"
                        )
                    )
                ],
                security_context=client.V1PodSecurityContext(
                    fs_group=1000,
                    run_as_non_root=True
                )
            )
        )
        
        # Deployment spec
        deployment_spec = client.V1DeploymentSpec(
            replicas=replicas,
            selector=client.V1LabelSelector(
                match_labels={
                    "app": app_name,
                    "deployment-id": deployment_id[:63]
                }
            ),
            template=pod_template,
            strategy=client.V1DeploymentStrategy(
                type="RollingUpdate",
                rolling_update=client.V1RollingUpdateDeployment(
                    max_surge=1,
                    max_unavailable=0
                )
            )
        )
        
        # Deployment
        deployment = client.V1Deployment(
            api_version="apps/v1",
            kind="Deployment",
            metadata=client.V1ObjectMeta(
                name=f"{app_name}-{deployment_id[:8]}",
                namespace=namespace,
                labels={
                    "app": app_name,
                    "tenant-id": tenant_id,
                    "managed-by": "kayo"
                }
            ),
            spec=deployment_spec
        )
        
        return deployment
    
    def _create_vector_sidecar(
        self,
        tenant_id: str,
        deployment_id: str
    ) -> client.V1Container:
        """
        Create Vector sidecar container for telemetry collection.
        
        Args:
            tenant_id: Tenant UUID
            deployment_id: Deployment UUID
        
        Returns:
            V1Container for Vector sidecar
        
        Security: Minimal permissions, isolated from app container
        Time complexity: O(1)
        """
        return client.V1Container(
            name="vector",
            image=settings.vector_image,
            args=["--config", "/etc/vector/vector.toml"],
            env=[
                client.V1EnvVar(name="VECTOR_SELF_NODE_NAME", value_from=client.V1EnvVarSource(
                    field_ref=client.V1ObjectFieldSelector(field_path="spec.nodeName")
                )),
                client.V1EnvVar(name="VECTOR_SELF_POD_NAME", value_from=client.V1EnvVarSource(
                    field_ref=client.V1ObjectFieldSelector(field_path="metadata.name")
                )),
                client.V1EnvVar(name="VECTOR_SELF_POD_NAMESPACE", value_from=client.V1EnvVarSource(
                    field_ref=client.V1ObjectFieldSelector(field_path="metadata.namespace")
                )),
                client.V1EnvVar(name="KAYO_TENANT_ID", value=tenant_id),
                client.V1EnvVar(name="KAYO_DEPLOYMENT_ID", value=deployment_id)
            ],
            resources=client.V1ResourceRequirements(
                limits={"memory": "256Mi", "cpu": "200m"},
                requests={"memory": "128Mi", "cpu": "100m"}
            ),
            volume_mounts=[
                client.V1VolumeMount(
                    name="logs",
                    mount_path="/var/log/app",
                    read_only=True
                ),
                client.V1VolumeMount(
                    name="vector-config",
                    mount_path="/etc/vector"
                )
            ],
            security_context=client.V1SecurityContext(
                run_as_non_root=True,
                run_as_user=1000,
                read_only_root_filesystem=True,
                allow_privilege_escalation=False,
                capabilities=client.V1Capabilities(drop=["ALL"])
            )
        )
    
    def generate_service(
        self,
        deployment_id: str,
        tenant_id: str,
        app_name: str,
        port: int = 8080
    ) -> client.V1Service:
        """
        Generate Service manifest for internal networking.
        
        Args:
            deployment_id: Deployment UUID
            tenant_id: Tenant UUID
            app_name: Application name
            port: Service port
        
        Returns:
            V1Service object
        
        Time complexity: O(1)
        """
        namespace = f"{settings.k8s_namespace_prefix}{tenant_id}"
        
        service = client.V1Service(
            api_version="v1",
            kind="Service",
            metadata=client.V1ObjectMeta(
                name=f"{app_name}-{deployment_id[:8]}",
                namespace=namespace,
                labels={
                    "app": app_name,
                    "tenant-id": tenant_id
                }
            ),
            spec=client.V1ServiceSpec(
                selector={
                    "app": app_name,
                    "deployment-id": deployment_id[:63]
                },
                ports=[
                    client.V1ServicePort(
                        name="http",
                        port=port,
                        target_port=8080,
                        protocol="TCP"
                    )
                ],
                type="ClusterIP"
            )
        )
        
        return service
    
    def generate_ingress(
        self,
        deployment_id: str,
        tenant_id: str,
        app_name: str,
        hostname: str
    ) -> client.V1Ingress:
        """
        Generate Ingress manifest for external access.
        
        Args:
            deployment_id: Deployment UUID
            tenant_id: Tenant UUID
            app_name: Application name
            hostname: External hostname
        
        Returns:
            V1Ingress object
        
        Security: TLS enabled, tenant isolation via hostname
        Time complexity: O(1)
        """
        namespace = f"{settings.k8s_namespace_prefix}{tenant_id}"
        service_name = f"{app_name}-{deployment_id[:8]}"
        
        ingress = client.V1Ingress(
            api_version="networking.k8s.io/v1",
            kind="Ingress",
            metadata=client.V1ObjectMeta(
                name=f"{app_name}-{deployment_id[:8]}",
                namespace=namespace,
                labels={
                    "app": app_name,
                    "tenant-id": tenant_id
                },
                annotations={
                    "cert-manager.io/cluster-issuer": "letsencrypt-prod",
                    "nginx.ingress.kubernetes.io/ssl-redirect": "true"
                }
            ),
            spec=client.V1IngressSpec(
                ingress_class_name="nginx",
                tls=[
                    client.V1IngressTLS(
                        hosts=[hostname],
                        secret_name=f"{app_name}-tls"
                    )
                ],
                rules=[
                    client.V1IngressRule(
                        host=hostname,
                        http=client.V1HTTPIngressRuleValue(
                            paths=[
                                client.V1HTTPIngressPath(
                                    path="/",
                                    path_type="Prefix",
                                    backend=client.V1IngressBackend(
                                        service=client.V1IngressServiceBackend(
                                            name=service_name,
                                            port=client.V1ServiceBackendPort(number=8080)
                                        )
                                    )
                                )
                            ]
                        )
                    )
                ]
            )
        )
        
        return ingress
    
    def generate_vector_config(
        self,
        deployment_id: str,
        tenant_id: str
    ) -> str:
        """
        Generate Vector configuration for sidecar.
        
        Args:
            deployment_id: Deployment UUID
            tenant_id: Tenant UUID
        
        Returns:
            Vector TOML configuration
        
        Time complexity: O(1)
        """
        config = f"""
# Vector sidecar configuration for deployment {deployment_id}

[sources.app_logs]
type = "file"
include = ["/var/log/app/*.log"]
read_from = "beginning"

[transforms.parse_logs]
type = "remap"
inputs = ["app_logs"]
source = '''
  .tenant_id = "{tenant_id}"
  .deployment_id = "{deployment_id}"
  .event_type = "application_log"
  .timestamp = now()
  .source = "application"
'''

[transforms.enrich]
type = "remap"
inputs = ["parse_logs"]
source = '''
  .pod_name = get_env_var!("VECTOR_SELF_POD_NAME")
  .pod_namespace = get_env_var!("VECTOR_SELF_POD_NAMESPACE")
  .node_name = get_env_var!("VECTOR_SELF_NODE_NAME")
'''

[sinks.kafka]
type = "kafka"
inputs = ["enrich"]
bootstrap_servers = "{settings.kafka_bootstrap_servers}"
topic = "telemetry.{{{{ tenant_id }}}}.application"
encoding.codec = "json"
compression = "snappy"

[sinks.kafka.buffer]
type = "memory"
max_events = 1000
when_full = "block"
"""
        return config
    
    @staticmethod
    def _get_resource_limits(tier: str) -> Dict[str, Dict[str, str]]:
        """
        Get resource limits by tier.
        
        Args:
            tier: Resource tier (basic, standard, premium)
        
        Returns:
            Dictionary with limits and requests
        
        Time complexity: O(1)
        """
        tiers = {
            "basic": {
                "limits": {"memory": "512Mi", "cpu": "500m"},
                "requests": {"memory": "256Mi", "cpu": "250m"}
            },
            "standard": {
                "limits": {"memory": "2Gi", "cpu": "2"},
                "requests": {"memory": "1Gi", "cpu": "1"}
            },
            "premium": {
                "limits": {"memory": "8Gi", "cpu": "4"},
                "requests": {"memory": "4Gi", "cpu": "2"}
            }
        }
        
        return tiers.get(tier, tiers["basic"])

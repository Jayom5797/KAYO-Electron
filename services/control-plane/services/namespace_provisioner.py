from kubernetes import client, config
from kubernetes.client.rest import ApiException
import logging
from typing import Dict, Optional

logger = logging.getLogger(__name__)


class NamespaceProvisioner:
    """
    Provisions and manages Kubernetes namespaces for tenant isolation.
    
    Each tenant gets a dedicated namespace with:
    - Resource quotas based on subscription tier
    - Network policies for isolation
    - Default service account with limited permissions
    """
    
    def __init__(self, in_cluster: bool = False):
        """
        Initialize Kubernetes client.
        
        Args:
            in_cluster: Whether running inside Kubernetes cluster
        """
        try:
            if in_cluster:
                config.load_incluster_config()
            else:
                config.load_kube_config()
            
            self.core_v1 = client.CoreV1Api()
            self.rbac_v1 = client.RbacAuthorizationV1Api()
            self.networking_v1 = client.NetworkingV1Api()
            
        except Exception as e:
            logger.error(f"Failed to initialize Kubernetes client: {e}")
            raise
    
    def provision_namespace(
        self,
        tenant_id: str,
        tenant_slug: str,
        tier: str
    ) -> str:
        """
        Provision a new namespace for a tenant.
        
        Args:
            tenant_id: UUID of the tenant
            tenant_slug: URL-safe tenant identifier
            tier: Subscription tier (free, pro, enterprise)
        
        Returns:
            Namespace name
        
        Raises:
            ApiException: If namespace creation fails
        
        Time complexity: O(1) - constant number of API calls
        """
        namespace_name = f"tenant-{tenant_slug}"
        
        try:
            # Create namespace
            namespace = client.V1Namespace(
                metadata=client.V1ObjectMeta(
                    name=namespace_name,
                    labels={
                        "kayo.io/tenant-id": tenant_id,
                        "kayo.io/tier": tier,
                        "kayo.io/managed-by": "kayo"
                    }
                )
            )
            self.core_v1.create_namespace(namespace)
            logger.info(f"Created namespace: {namespace_name}")
            
            # Apply resource quota
            self._apply_resource_quota(namespace_name, tier)
            
            # Apply limit range
            self._apply_limit_range(namespace_name)
            
            # Apply network policies
            self._apply_network_policies(namespace_name)
            
            # Create default service account
            self._create_service_account(namespace_name)
            
            return namespace_name
            
        except ApiException as e:
            if e.status == 409:
                logger.warning(f"Namespace {namespace_name} already exists")
                return namespace_name
            logger.error(f"Failed to provision namespace: {e}")
            raise
    
    def _apply_resource_quota(self, namespace: str, tier: str):
        """
        Apply ResourceQuota based on tenant tier.
        
        Quotas enforce resource limits per tenant to prevent resource exhaustion.
        
        Time complexity: O(1)
        """
        quotas = {
            "free": {
                "requests.cpu": "2",
                "requests.memory": "4Gi",
                "limits.cpu": "4",
                "limits.memory": "8Gi",
                "pods": "10",
                "services": "5",
                "persistentvolumeclaims": "3"
            },
            "pro": {
                "requests.cpu": "10",
                "requests.memory": "20Gi",
                "limits.cpu": "20",
                "limits.memory": "40Gi",
                "pods": "50",
                "services": "20",
                "persistentvolumeclaims": "10"
            },
            "enterprise": {
                "requests.cpu": "100",
                "requests.memory": "200Gi",
                "limits.cpu": "200",
                "limits.memory": "400Gi",
                "pods": "500",
                "services": "100",
                "persistentvolumeclaims": "50"
            }
        }
        
        quota = client.V1ResourceQuota(
            metadata=client.V1ObjectMeta(name="tenant-quota"),
            spec=client.V1ResourceQuotaSpec(
                hard=quotas.get(tier, quotas["free"])
            )
        )
        
        try:
            self.core_v1.create_namespaced_resource_quota(namespace, quota)
            logger.info(f"Applied resource quota for tier: {tier}")
        except ApiException as e:
            if e.status != 409:
                logger.error(f"Failed to create resource quota: {e}")
                raise
    
    def _apply_limit_range(self, namespace: str):
        """
        Apply LimitRange for default pod resource limits.
        
        Prevents pods from consuming excessive resources if limits not specified.
        
        Time complexity: O(1)
        """
        limit_range = client.V1LimitRange(
            metadata=client.V1ObjectMeta(name="tenant-limits"),
            spec=client.V1LimitRangeSpec(
                limits=[
                    client.V1LimitRangeItem(
                        type="Container",
                        default={
                            "cpu": "500m",
                            "memory": "512Mi"
                        },
                        default_request={
                            "cpu": "100m",
                            "memory": "128Mi"
                        },
                        max={
                            "cpu": "2",
                            "memory": "4Gi"
                        }
                    ),
                    client.V1LimitRangeItem(
                        type="Pod",
                        max={
                            "cpu": "4",
                            "memory": "8Gi"
                        }
                    )
                ]
            )
        )
        
        try:
            self.core_v1.create_namespaced_limit_range(namespace, limit_range)
            logger.info(f"Applied limit range for namespace: {namespace}")
        except ApiException as e:
            if e.status != 409:
                logger.error(f"Failed to create limit range: {e}")
                raise
    
    def _apply_network_policies(self, namespace: str):
        """
        Apply NetworkPolicies for tenant isolation.
        
        Policies:
        1. Default deny all ingress
        2. Allow intra-namespace communication
        3. Allow egress to DNS and external services
        
        Security: Enforces network-level tenant isolation
        Time complexity: O(1)
        """
        # Default deny ingress
        deny_ingress = client.V1NetworkPolicy(
            metadata=client.V1ObjectMeta(name="default-deny-ingress"),
            spec=client.V1NetworkPolicySpec(
                pod_selector=client.V1LabelSelector(),
                policy_types=["Ingress"]
            )
        )
        
        # Allow intra-namespace communication
        allow_same_namespace = client.V1NetworkPolicy(
            metadata=client.V1ObjectMeta(name="allow-same-namespace"),
            spec=client.V1NetworkPolicySpec(
                pod_selector=client.V1LabelSelector(),
                policy_types=["Ingress"],
                ingress=[
                    client.V1NetworkPolicyIngressRule(
                        _from=[
                            client.V1NetworkPolicyPeer(
                                pod_selector=client.V1LabelSelector()
                            )
                        ]
                    )
                ]
            )
        )
        
        # Allow DNS and external egress
        allow_egress = client.V1NetworkPolicy(
            metadata=client.V1ObjectMeta(name="allow-dns-egress"),
            spec=client.V1NetworkPolicySpec(
                pod_selector=client.V1LabelSelector(),
                policy_types=["Egress"],
                egress=[
                    # Allow DNS
                    client.V1NetworkPolicyEgressRule(
                        to=[
                            client.V1NetworkPolicyPeer(
                                namespace_selector=client.V1LabelSelector(
                                    match_labels={"name": "kube-system"}
                                )
                            )
                        ],
                        ports=[
                            client.V1NetworkPolicyPort(protocol="UDP", port=53)
                        ]
                    ),
                    # Allow all egress (can be restricted further)
                    client.V1NetworkPolicyEgressRule(
                        to=[
                            client.V1NetworkPolicyPeer(
                                ip_block=client.V1IPBlock(
                                    cidr="0.0.0.0/0",
                                    _except=["169.254.169.254/32"]  # Block metadata service
                                )
                            )
                        ]
                    )
                ]
            )
        )
        
        policies = [deny_ingress, allow_same_namespace, allow_egress]
        
        for policy in policies:
            try:
                self.networking_v1.create_namespaced_network_policy(namespace, policy)
                logger.info(f"Applied network policy: {policy.metadata.name}")
            except ApiException as e:
                if e.status != 409:
                    logger.error(f"Failed to create network policy: {e}")
                    raise
    
    def _create_service_account(self, namespace: str):
        """
        Create default service account with limited permissions.
        
        Security: Implements least-privilege access for tenant workloads
        Time complexity: O(1)
        """
        service_account = client.V1ServiceAccount(
            metadata=client.V1ObjectMeta(name="default-app")
        )
        
        try:
            self.core_v1.create_namespaced_service_account(namespace, service_account)
        except ApiException as e:
            if e.status != 409:
                logger.error(f"Failed to create service account: {e}")
                raise
        
        # Create role with minimal permissions
        role = client.V1Role(
            metadata=client.V1ObjectMeta(name="app-role"),
            rules=[
                client.V1PolicyRule(
                    api_groups=[""],
                    resources=["pods", "services"],
                    verbs=["get", "list"]
                )
            ]
        )
        
        try:
            self.rbac_v1.create_namespaced_role(namespace, role)
        except ApiException as e:
            if e.status != 409:
                logger.error(f"Failed to create role: {e}")
                raise
        
        # Bind role to service account
        role_binding = client.V1RoleBinding(
            metadata=client.V1ObjectMeta(name="app-role-binding"),
            subjects=[
                client.V1Subject(
                    kind="ServiceAccount",
                    name="default-app",
                    namespace=namespace
                )
            ],
            role_ref=client.V1RoleRef(
                kind="Role",
                name="app-role",
                api_group="rbac.authorization.k8s.io"
            )
        )
        
        try:
            self.rbac_v1.create_namespaced_role_binding(namespace, role_binding)
            logger.info(f"Created service account and RBAC for namespace: {namespace}")
        except ApiException as e:
            if e.status != 409:
                logger.error(f"Failed to create role binding: {e}")
                raise
    
    def delete_namespace(self, namespace: str):
        """
        Delete namespace and all resources.
        
        Args:
            namespace: Namespace name to delete
        
        Time complexity: O(1) - API call, actual deletion is async
        """
        try:
            self.core_v1.delete_namespace(namespace)
            logger.info(f"Deleted namespace: {namespace}")
        except ApiException as e:
            if e.status != 404:
                logger.error(f"Failed to delete namespace: {e}")
                raise

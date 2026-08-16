from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """Deployment orchestrator configuration"""
    
    # Service
    service_name: str = "deployment-orchestrator"
    log_level: str = "INFO"
    
    # PostgreSQL
    database_url: str = "postgresql://kayo:kayo_dev_password@localhost:5432/kayo_control_plane"
    
    # Kubernetes
    k8s_in_cluster: bool = False  # Set to True when running in K8s
    k8s_namespace_prefix: str = "kayo-tenant-"
    
    # Container Registry
    registry_url: str = "localhost:5000"
    registry_username: Optional[str] = None
    registry_password: Optional[str] = None
    
    # Build
    build_timeout: int = 600  # 10 minutes
    build_memory_limit: str = "2Gi"
    build_cpu_limit: str = "2"
    
    # Vector sidecar
    vector_image: str = "timberio/vector:0.34.0-alpine"
    vector_config_template: str = "/app/templates/vector-sidecar.toml"
    
    # Kafka
    kafka_bootstrap_servers: str = "localhost:9092"
    
    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()

from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    """Graph engine service configuration"""
    
    # Service
    service_name: str = "graph-engine"
    log_level: str = "INFO"
    
    # Kafka
    kafka_bootstrap_servers: List[str] = ["localhost:9092"]
    kafka_group_id: str = "graph-engine-consumer"
    kafka_topic_pattern: str = "telemetry\\..*\\..*"
    
    # Neo4j (will connect to tenant-specific databases)
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_admin_user: str = "neo4j"
    neo4j_admin_password: str = "kayo_dev_password"
    
    # PostgreSQL (for tenant database credentials)
    database_url: str = "postgresql://kayo:kayo_dev_password@localhost:5432/kayo_control_plane"
    
    # Performance
    batch_size: int = 1000
    batch_timeout: int = 10
    
    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()

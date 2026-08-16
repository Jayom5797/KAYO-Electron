from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Detection engine configuration"""
    
    # Service
    service_name: str = "detection-engine"
    log_level: str = "INFO"
    
    # Kafka
    kafka_bootstrap_servers: str = "localhost:9092"
    
    # Neo4j
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_admin_user: str = "neo4j"
    neo4j_admin_password: str = "kayo_dev_password"
    
    # PostgreSQL
    database_url: str = "postgresql://kayo:kayo_dev_password@localhost:5432/kayo_control_plane"
    
    # Detection
    detection_interval: int = 60  # seconds (legacy - not used in event-driven mode)
    lookback_window: int = 3600  # seconds (1 hour)
    
    # Rules
    rules_directory: str = "rules"
    
    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()

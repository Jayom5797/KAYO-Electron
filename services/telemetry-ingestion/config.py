from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    """Telemetry ingestion service configuration"""
    
    # Service
    service_name: str = "telemetry-ingestion"
    log_level: str = "INFO"
    
    # Kafka
    kafka_bootstrap_servers: List[str] = ["localhost:9092"]
    kafka_group_id: str = "clickhouse-consumer"
    kafka_topic_pattern: str = "telemetry\\..*\\..*"
    kafka_auto_offset_reset: str = "earliest"
    kafka_enable_auto_commit: bool = False
    kafka_max_poll_records: int = 10000
    
    # ClickHouse
    clickhouse_host: str = "localhost"
    clickhouse_port: int = 9000
    clickhouse_database: str = "kayo_events"
    clickhouse_user: str = "kayo"
    clickhouse_password: str = "kayo_dev_password"
    clickhouse_batch_size: int = 10000
    clickhouse_batch_timeout: int = 5
    
    # Performance
    worker_threads: int = 4
    
    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()

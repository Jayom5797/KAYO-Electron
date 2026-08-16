from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """AI Explainer service configuration"""
    
    # Service
    service_name: str = "ai-explainer"
    log_level: str = "INFO"
    
    # PostgreSQL
    database_url: str = "postgresql://kayo:kayo_dev_password@localhost:5432/kayo_control_plane"
    
    # Redis (for caching)
    redis_url: str = "redis://localhost:6379/0"
    cache_ttl: int = 3600  # 1 hour
    
    # LLM Configuration
    llm_provider: str = "openai"  # openai, anthropic, or vllm
    openai_api_key: Optional[str] = None
    openai_model: str = "gpt-4-turbo-preview"
    openai_max_tokens: int = 2000
    openai_temperature: float = 0.3
    
    # vLLM (self-hosted) configuration
    vllm_endpoint: Optional[str] = None
    vllm_model: str = "meta-llama/Llama-2-70b-chat-hf"
    
    # Rate limiting
    max_requests_per_minute: int = 60
    max_tokens_per_tenant_per_day: int = 100000
    
    # Context limits
    max_events_in_context: int = 50
    max_graph_nodes_in_context: int = 100
    
    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()

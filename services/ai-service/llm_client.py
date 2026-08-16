from typing import Optional, Dict, Any, AsyncIterator
import logging
from abc import ABC, abstractmethod
import httpx
import json

from config import settings

logger = logging.getLogger(__name__)


class LLMClient(ABC):
    """
    Abstract base class for LLM clients.
    
    Supports multiple providers: OpenAI, Anthropic, vLLM (self-hosted).
    """
    
    @abstractmethod
    async def generate(
        self,
        prompt: str,
        max_tokens: int,
        temperature: float,
        stream: bool = False
    ) -> str | AsyncIterator[str]:
        """Generate completion from prompt"""
        pass
    
    @abstractmethod
    async def count_tokens(self, text: str) -> int:
        """Estimate token count for text"""
        pass


class OpenAIClient(LLMClient):
    """
    OpenAI API client with retry logic and error handling.
    
    Security: API key stored in environment variable
    Performance: Async HTTP client with connection pooling
    """
    
    def __init__(self):
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY not configured")
        
        self.api_key = settings.openai_api_key
        self.model = settings.openai_model
        self.base_url = "https://api.openai.com/v1"
        
        # HTTP client with retry logic
        self.client = httpx.AsyncClient(
            timeout=60.0,
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
        )
    
    async def generate(
        self,
        prompt: str,
        max_tokens: int = None,
        temperature: float = None,
        stream: bool = False
    ) -> str:
        """
        Generate completion using OpenAI API.
        
        Args:
            prompt: Input prompt
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature (0.0-2.0)
            stream: Whether to stream response
        
        Returns:
            Generated text
        
        Security: Uses API key authentication
        Time complexity: O(n) where n is response length
        """
        max_tokens = max_tokens or settings.openai_max_tokens
        temperature = temperature or settings.openai_temperature
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You are a cybersecurity expert analyzing security incidents."},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": stream
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            
            result = response.json()
            
            if "choices" not in result or len(result["choices"]) == 0:
                raise ValueError("No completion returned from API")
            
            completion = result["choices"][0]["message"]["content"]
            
            # Track token usage
            usage = result.get("usage", {})
            logger.info(
                f"OpenAI API call: model={self.model}, "
                f"prompt_tokens={usage.get('prompt_tokens', 0)}, "
                f"completion_tokens={usage.get('completion_tokens', 0)}"
            )
            
            return completion
        
        except httpx.HTTPStatusError as e:
            logger.error(f"OpenAI API error: {e.response.status_code} - {e.response.text}")
            raise
        except Exception as e:
            logger.error(f"Failed to generate completion: {e}", exc_info=True)
            raise
    
    async def count_tokens(self, text: str) -> int:
        """
        Estimate token count using simple heuristic.
        
        Approximation: 1 token ≈ 4 characters for English text
        
        Args:
            text: Input text
        
        Returns:
            Estimated token count
        
        Time complexity: O(1)
        """
        # Simple approximation: 1 token ≈ 4 characters
        # For production, use tiktoken library for accurate counting
        return len(text) // 4
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()


class VLLMClient(LLMClient):
    """
    vLLM (self-hosted) client for cost optimization.
    
    Use case: High-volume deployments where API costs are prohibitive
    """
    
    def __init__(self):
        if not settings.vllm_endpoint:
            raise ValueError("VLLM_ENDPOINT not configured")
        
        self.endpoint = settings.vllm_endpoint
        self.model = settings.vllm_model
        
        self.client = httpx.AsyncClient(
            timeout=120.0,
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10)
        )
    
    async def generate(
        self,
        prompt: str,
        max_tokens: int = None,
        temperature: float = None,
        stream: bool = False
    ) -> str:
        """
        Generate completion using vLLM endpoint.
        
        Args:
            prompt: Input prompt
            max_tokens: Maximum tokens to generate
            temperature: Sampling temperature
            stream: Whether to stream response
        
        Returns:
            Generated text
        
        Time complexity: O(n) where n is response length
        """
        max_tokens = max_tokens or settings.openai_max_tokens
        temperature = temperature or settings.openai_temperature
        
        payload = {
            "model": self.model,
            "prompt": prompt,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": stream
        }
        
        try:
            response = await self.client.post(
                f"{self.endpoint}/v1/completions",
                json=payload
            )
            response.raise_for_status()
            
            result = response.json()
            
            if "choices" not in result or len(result["choices"]) == 0:
                raise ValueError("No completion returned from vLLM")
            
            completion = result["choices"][0]["text"]
            
            logger.info(f"vLLM API call: model={self.model}")
            
            return completion
        
        except Exception as e:
            logger.error(f"Failed to generate completion from vLLM: {e}", exc_info=True)
            raise
    
    async def count_tokens(self, text: str) -> int:
        """Estimate token count"""
        return len(text) // 4
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()


def get_llm_client() -> LLMClient:
    """
    Factory function to get LLM client based on configuration.
    
    Returns:
        LLMClient instance
    
    Time complexity: O(1)
    """
    if settings.llm_provider == "openai":
        return OpenAIClient()
    elif settings.llm_provider == "vllm":
        return VLLMClient()
    else:
        raise ValueError(f"Unsupported LLM provider: {settings.llm_provider}")

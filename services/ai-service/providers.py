"""
AI Provider Abstraction Layer

Provides a unified interface for multiple LLM providers.
Currently supports:
- OpenAI (GPT-4, GPT-3.5)
- Groq (Llama 3.3 70B)

Ensures sensitive data is redacted before external API calls.
"""
import os
import json
import logging
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
import re

logger = logging.getLogger(__name__)


# ── Redaction ──────────────────────────────────────────────────────────────────

SENSITIVE_PATTERNS = [
    (r'\b(AKIA[0-9A-Z]{16})\b', '[REDACTED_AWS_KEY]'),
    (r'\b(ghp_[A-Za-z0-9]{30,})\b', '[REDACTED_GITHUB_TOKEN]'),
    (r'\b(sk_(live|test)_[0-9a-zA-Z]{24,})\b', '[REDACTED_STRIPE_KEY]'),
    (r'-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----', '[REDACTED_PRIVATE_KEY]'),
    (r'\b(mongodb(\+srv)?://[^:@\s]+:[^@\s]+@[^\s]+)\b', '[REDACTED_CONNECTION_STRING]'),
    (r'\b(postgres(ql)?://[^:@\s]+:[^@\s]+@[^\s]+)\b', '[REDACTED_CONNECTION_STRING]'),
    (r'(password|passwd|secret|api_key)\s*[=:]\s*["\']?([^\s"\']{8,})["\']?', r'\1=[REDACTED]'),
]


def redact_sensitive(text: str) -> str:
    """Remove sensitive data from text before sending to external AI."""
    for pattern, replacement in SENSITIVE_PATTERNS:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    return text


# ── Provider Interface ─────────────────────────────────────────────────────────

class AIProvider(ABC):
    """Abstract base for AI providers."""

    @abstractmethod
    async def generate(self, prompt: str, max_tokens: int = 1000, temperature: float = 0.3) -> str:
        """Generate text from a prompt."""
        pass

    @abstractmethod
    async def count_tokens(self, text: str) -> int:
        """Estimate token count for billing/tracking."""
        pass

    async def close(self):
        """Cleanup resources."""
        pass


# ── OpenAI Provider ────────────────────────────────────────────────────────────

class OpenAIProvider(AIProvider):
    """OpenAI API provider (GPT-4, GPT-3.5)."""

    def __init__(self, api_key: Optional[str] = None, model: str = "gpt-4"):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.model = model

    async def generate(self, prompt: str, max_tokens: int = 1000, temperature: float = 0.3) -> str:
        import httpx

        safe_prompt = redact_sensitive(prompt)

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": safe_prompt}],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]

    async def count_tokens(self, text: str) -> int:
        # Rough estimate: ~4 chars per token
        return len(text) // 4


# ── Groq Provider ──────────────────────────────────────────────────────────────

class GroqProvider(AIProvider):
    """Groq API provider (Llama 3.3 70B)."""

    def __init__(self, api_key: Optional[str] = None, model: str = "llama-3.3-70b-versatile"):
        self.api_key = api_key or os.environ.get("GROQ_API_KEY", "")
        self.model = model

    async def generate(self, prompt: str, max_tokens: int = 1000, temperature: float = 0.3) -> str:
        import httpx

        safe_prompt = redact_sensitive(prompt)

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": safe_prompt}],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]

    async def count_tokens(self, text: str) -> int:
        return len(text) // 4


# ── Unified AI Service ─────────────────────────────────────────────────────────

class UnifiedAIService:
    """
    Unified AI service with common operations.

    Usage:
        ai = UnifiedAIService(provider="groq")
        summary = await ai.summarize_scan(scan_data)
    """

    def __init__(self, provider: str = "openai", api_key: Optional[str] = None):
        if provider == "groq":
            self.provider = GroqProvider(api_key=api_key)
        elif provider == "openai":
            self.provider = OpenAIProvider(api_key=api_key)
        else:
            raise ValueError(f"Unknown provider: {provider}. Supported: openai, groq")

        self.provider_name = provider

    async def summarize_scan(self, scan_data: Dict[str, Any]) -> str:
        """Generate executive summary of a security scan."""
        prompt = f"""You are a senior application security engineer. Analyze this security scan and provide a concise executive summary.

SCAN DATA:
- Target: {scan_data.get('target', 'unknown')}
- Type: {scan_data.get('type', 'unknown')}
- Posture Score: {scan_data.get('posture_score', 'N/A')}/100
- Findings: {json.dumps(scan_data.get('finding_counts', {}), indent=2)}
- Total Findings: {scan_data.get('total_findings', 0)}

Provide:
1. Overall risk assessment (1-2 sentences)
2. Top 3 most critical issues
3. Immediate recommended actions

Be specific and actionable. Keep response under 300 words."""

        return await self.provider.generate(prompt, max_tokens=500)

    async def explain_finding(self, finding_data: Dict[str, Any]) -> str:
        """Explain a security finding in plain language."""
        prompt = f"""Explain this security finding clearly:

Type: {finding_data.get('type')}
Severity: {finding_data.get('severity')}
Category: {finding_data.get('category')}
Description: {finding_data.get('description')}
Endpoint: {finding_data.get('endpoint', 'N/A')}

Explain:
1. What this means in plain language
2. Why it's a security risk
3. How to fix it (specific steps)

Keep response under 200 words. Be technical but clear."""

        return await self.provider.generate(prompt, max_tokens=400)

    async def explain_incident(self, incident_data: Dict[str, Any]) -> str:
        """Generate AI explanation for a security incident."""
        prompt = f"""You are a security analyst. Explain this security incident:

Severity: {incident_data.get('severity')}
Attack Pattern: {incident_data.get('attack_pattern')}
MITRE Technique: {incident_data.get('mitre_technique')}
Event Chain: {json.dumps(incident_data.get('event_chain', [])[:5])}

Provide:
1. Technical summary (what happened)
2. Impact assessment
3. Recommended immediate response
4. Long-term remediation

Be specific to the MITRE technique. Keep under 400 words."""

        return await self.provider.generate(prompt, max_tokens=800)

    async def generate_remediation(self, findings: list) -> str:
        """Generate prioritized remediation plan from findings."""
        summary = []
        for f in findings[:10]:
            summary.append(f"- [{f.get('severity')}] {f.get('category')}: {f.get('description', '')[:100]}")

        prompt = f"""Create a prioritized remediation plan for these security findings:

{chr(10).join(summary)}

Provide:
1. Prioritized action items (most critical first)
2. Estimated effort for each (low/medium/high)
3. Quick wins that can be done immediately

Be specific — include actual commands, configurations, or code changes where relevant. Keep under 500 words."""

        return await self.provider.generate(prompt, max_tokens=800)

    async def close(self):
        await self.provider.close()


def get_ai_service(provider: Optional[str] = None) -> UnifiedAIService:
    """Factory function to create AI service from environment."""
    if provider is None:
        provider = os.environ.get("LLM_PROVIDER", "openai")
    return UnifiedAIService(provider=provider)

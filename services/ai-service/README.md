# AI Incident Explanation Service

Generates human-readable explanations of security incidents using Large Language Models.

## Architecture

```
┌─────────────────┐
│   Incident API  │
└────────┬────────┘
         │
         v
┌─────────────────────────┐
│  ExplanationService     │
│  - Context Assembly     │
│  - LLM Integration      │
│  - Caching              │
│  - Rate Limiting        │
└─────────┬───────────────┘
          │
    ┌─────┴─────┐
    v           v
┌────────┐  ┌────────┐
│  LLM   │  │ Redis  │
│ Client │  │ Cache  │
└────────┘  └────────┘
```

## Features

- **Multi-Provider LLM Support**: OpenAI GPT-4, self-hosted vLLM
- **Intelligent Caching**: Redis-based caching to reduce API costs
- **Rate Limiting**: Token usage tracking per tenant
- **Context Assembly**: Extracts relevant data from incidents, attack paths, events
- **Multiple Explanation Types**:
  - Technical summary (for security analysts)
  - Executive summary (for business stakeholders)
  - Attack narrative (chronological story)
  - Remediation recommendations (actionable steps)

## Configuration

Environment variables:

```bash
# LLM Provider
LLM_PROVIDER=openai  # or vllm
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_MAX_TOKENS=2000
OPENAI_TEMPERATURE=0.3

# vLLM (self-hosted)
VLLM_ENDPOINT=http://localhost:8000
VLLM_MODEL=meta-llama/Llama-2-70b-chat-hf

# Rate Limiting
MAX_REQUESTS_PER_MINUTE=60
MAX_TOKENS_PER_TENANT_PER_DAY=100000

# Caching
REDIS_URL=redis://localhost:6379/0
CACHE_TTL=3600

# Database
DATABASE_URL=postgresql://kayo:password@localhost:5432/kayo_control_plane
```

## Usage

### Via API

```bash
# Generate explanation for incident
POST /api/incidents/{incident_id}/explain
{
  "force_regenerate": false
}

# Response
{
  "incident_id": "uuid",
  "technical_summary": "...",
  "executive_summary": "...",
  "attack_narrative": "...",
  "remediation": "...",
  "confidence_score": 0.85,
  "mitre_technique": "T1078",
  "severity": "critical"
}
```

### Programmatic

```python
from explanation_service import ExplanationService

service = ExplanationService()
await service.initialize()

explanation = await service.generate_incident_explanation(
    incident_id="uuid",
    tenant_id="uuid",
    force_regenerate=False
)

await service.cleanup()
```

## Prompt Engineering

Prompts are designed to:
- **Minimize hallucination**: Ground responses in provided data
- **Ensure factual accuracy**: Explicitly state when data is unavailable
- **Generate actionable insights**: Focus on remediation steps
- **Map to frameworks**: Include MITRE ATT&CK context

See `prompt_templates.py` for implementation.

## Performance

- **Cache hit**: O(1) - Redis lookup
- **Cache miss**: O(n) - LLM generation time (2-10 seconds)
- **Token estimation**: O(1) - Simple heuristic (1 token ≈ 4 chars)

## Cost Optimization

1. **Caching**: Explanations cached for 1 hour (configurable)
2. **Rate limiting**: Daily token limits per tenant
3. **Context pruning**: Limits events and graph nodes in context
4. **Self-hosted option**: vLLM support for high-volume deployments

## Security

- **API key protection**: Stored in environment variables
- **Tenant isolation**: All queries filtered by tenant_id
- **Rate limiting**: Prevents abuse and cost overruns
- **Input validation**: Context size limits enforced

## Dependencies

```
sqlalchemy==2.0.25
psycopg2-binary==2.9.9
pydantic==2.5.3
pydantic-settings==2.1.0
httpx==0.26.0
redis==5.0.1
python-json-logger==2.0.7
```

## Integration Points

- **Control Plane**: Reads incident data from PostgreSQL
- **Detection Engine**: Uses attack path reconstruction results
- **Redis**: Caching and rate limiting
- **OpenAI/vLLM**: LLM inference

## Future Enhancements

- Streaming responses for real-time updates
- Multi-language support (translation)
- Custom prompt templates per tenant
- Feedback loop for explanation quality
- Integration with ticketing systems (Jira, ServiceNow)

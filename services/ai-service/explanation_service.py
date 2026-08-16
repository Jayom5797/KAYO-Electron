from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from typing import Dict, Any, Optional
import logging
import json
import hashlib
import redis.asyncio as redis

from config import settings
from llm_client import get_llm_client, LLMClient
from prompt_templates import PromptTemplates

logging.basicConfig(
    level=settings.log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class ExplanationService:
    """
    Generate AI-powered explanations for security incidents.
    
    Architecture:
    - Assembles context from incident data, attack paths, and events
    - Uses LLM to generate human-readable explanations
    - Caches results to reduce API costs
    - Tracks token usage per tenant
    
    Performance:
    - Cache hit: O(1)
    - Cache miss: O(n) where n is LLM response time
    """
    
    def __init__(self):
        """Initialize service with database and LLM client"""
        # PostgreSQL for incident data
        engine = create_engine(settings.database_url)
        Session = sessionmaker(bind=engine)
        self.db_session = Session()
        
        # Redis for caching
        self.redis_client = None  # Initialized in async context
        
        # LLM client
        self.llm_client: Optional[LLMClient] = None
        
        logger.info(f"Initialized ExplanationService with provider: {settings.llm_provider}")
    
    async def initialize(self):
        """Initialize async components"""
        self.redis_client = await redis.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True
        )
        self.llm_client = get_llm_client()
    
    async def generate_incident_explanation(
        self,
        incident_id: str,
        tenant_id: str,
        force_regenerate: bool = False
    ) -> Dict[str, Any]:
        """
        Generate comprehensive explanation for incident.
        
        Args:
            incident_id: Incident UUID
            tenant_id: Tenant UUID
            force_regenerate: Skip cache and regenerate
        
        Returns:
            Dictionary with explanation components
        
        Security: Tenant isolation enforced
        Time complexity: O(1) cache hit, O(n) cache miss
        """
        # Check cache first
        if not force_regenerate:
            cached = await self._get_cached_explanation(incident_id)
            if cached:
                logger.info(f"Cache hit for incident {incident_id}")
                return cached
        
        # Assemble context
        context = await self._assemble_context(incident_id, tenant_id)
        
        if not context:
            raise ValueError(f"Failed to assemble context for incident {incident_id}")
        
        # Generate explanations
        try:
            # 1. Technical summary
            summary_prompt = PromptTemplates.incident_summary(
                context['incident'],
                context['attack_path'],
                context['events']
            )
            
            technical_summary = await self.llm_client.generate(
                summary_prompt,
                max_tokens=1000,
                temperature=0.3
            )
            
            # 2. Remediation recommendations
            remediation_prompt = PromptTemplates.remediation_recommendations(
                context['incident'],
                context['attack_path']
            )
            
            remediation = await self.llm_client.generate(
                remediation_prompt,
                max_tokens=1500,
                temperature=0.3
            )
            
            # 3. Executive summary
            exec_prompt = PromptTemplates.executive_summary(
                context['incident'],
                context['attack_path'],
                technical_summary
            )
            
            executive_summary = await self.llm_client.generate(
                exec_prompt,
                max_tokens=300,
                temperature=0.3
            )
            
            # 4. Attack narrative
            narrative_prompt = PromptTemplates.attack_narrative(
                context['attack_path']
            )
            
            attack_narrative = await self.llm_client.generate(
                narrative_prompt,
                max_tokens=1000,
                temperature=0.4
            )
            
            explanation = {
                'incident_id': incident_id,
                'technical_summary': technical_summary,
                'executive_summary': executive_summary,
                'attack_narrative': attack_narrative,
                'remediation': remediation,
                'confidence_score': context['attack_path'].get('confidence_score', 0.0),
                'mitre_technique': context['incident'].get('mitre_technique'),
                'severity': context['incident'].get('severity')
            }
            
            # Cache result
            await self._cache_explanation(incident_id, explanation)
            
            # Track token usage
            await self._track_token_usage(tenant_id, technical_summary, remediation, executive_summary, attack_narrative)
            
            logger.info(f"Generated explanation for incident {incident_id}")
            
            return explanation
        
        except Exception as e:
            logger.error(f"Failed to generate explanation: {e}", exc_info=True)
            raise
    
    async def _assemble_context(
        self,
        incident_id: str,
        tenant_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Assemble context for LLM from multiple sources.
        
        Args:
            incident_id: Incident UUID
            tenant_id: Tenant UUID
        
        Returns:
            Context dictionary with incident, attack_path, events
        
        Security: Tenant isolation enforced via database queries
        Time complexity: O(n) where n is number of events
        """
        try:
            import sys
            sys.path.append('../../services/control-plane')
            from models.incident import Incident
            
            # Get incident
            incident = self.db_session.query(Incident).filter(
                Incident.incident_id == incident_id,
                Incident.tenant_id == tenant_id
            ).first()
            
            if not incident:
                logger.error(f"Incident {incident_id} not found for tenant {tenant_id}")
                return None
            
            # Get attack path (from graph reconstruction)
            attack_path = self._get_attack_path(incident_id, tenant_id)
            
            # Get related events (from ClickHouse)
            events = self._get_related_events(incident.event_chain[:settings.max_events_in_context])
            
            return {
                'incident': {
                    'incident_id': str(incident.incident_id),
                    'severity': incident.severity,
                    'status': incident.status,
                    'attack_pattern': incident.attack_pattern,
                    'mitre_technique': incident.mitre_technique,
                    'created_at': incident.created_at.isoformat() if incident.created_at else None
                },
                'attack_path': attack_path,
                'events': events
            }
        
        except Exception as e:
            logger.error(f"Failed to assemble context: {e}", exc_info=True)
            return None
    
    def _get_attack_path(self, incident_id: str, tenant_id: str) -> Dict[str, Any]:
        """
        Get attack path from incident's graph_snapshot.
        Falls back to empty structure if not available.
        """
        try:
            import sys, os
            sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../control-plane')))
            from models.incident import Incident
            import uuid

            incident = self.db_session.query(Incident).filter(
                Incident.incident_id == uuid.UUID(incident_id),
                Incident.tenant_id == uuid.UUID(tenant_id)
            ).first()

            if incident and incident.graph_snapshot:
                snap = incident.graph_snapshot
                return {
                    'root_cause': snap.get('root_cause', []),
                    'attack_chain': snap.get('attack_chain', snap.get('nodes', [])),
                    'timeline': snap.get('timeline', []),
                    'confidence_score': snap.get('confidence_score', 0.5),
                    'affected_entities': snap.get('affected_entities', {
                        'users': [], 'hosts': [], 'processes': [], 'files': [], 'ip_addresses': []
                    }),
                    'mitre_tactics': snap.get('mitre_tactics', []),
                    'mitre_techniques': snap.get('mitre_techniques', []),
                }
        except Exception as e:
            logger.warning(f"Could not load graph_snapshot: {e}")

        return {
            'root_cause': [],
            'attack_chain': [],
            'timeline': [],
            'confidence_score': 0.0,
            'affected_entities': {'users': [], 'hosts': [], 'processes': [], 'files': [], 'ip_addresses': []}
        }

    def _get_related_events(self, event_ids: list) -> list:
        """
        Fetch events from ClickHouse by event_id list.
        Returns empty list gracefully if ClickHouse is unavailable.
        """
        if not event_ids:
            return []
        try:
            from clickhouse_driver import Client
            ch = Client(
                host=settings.clickhouse_host if hasattr(settings, 'clickhouse_host') else 'localhost',
                port=int(settings.clickhouse_port) if hasattr(settings, 'clickhouse_port') else 9000,
                database=settings.clickhouse_database if hasattr(settings, 'clickhouse_database') else 'kayo_events',
                user=settings.clickhouse_user if hasattr(settings, 'clickhouse_user') else 'kayo',
                password=settings.clickhouse_password if hasattr(settings, 'clickhouse_password') else 'kayo_dev_password',
                connect_timeout=3,
            )
            ids = [str(e) for e in event_ids[:50]]
            placeholders = ', '.join([f"'{i}'" for i in ids])
            rows = ch.execute(
                f"SELECT event_id, source_type, event_category, event_type, event_action, "
                f"process_name, host_name, user_name, timestamp "
                f"FROM events WHERE toString(event_id) IN ({placeholders}) LIMIT 50"
            )
            return [
                {
                    'event_id': str(r[0]), 'source_type': r[1], 'category': r[2],
                    'type': r[3], 'action': r[4], 'process': r[5],
                    'host': r[6], 'user': r[7], 'timestamp': str(r[8])
                }
                for r in rows
            ]
        except Exception as e:
            logger.warning(f"ClickHouse event fetch failed (non-fatal): {e}")
            return []
    
    async def _get_cached_explanation(self, incident_id: str) -> Optional[Dict[str, Any]]:
        """
        Get cached explanation from Redis.
        
        Args:
            incident_id: Incident UUID
        
        Returns:
            Cached explanation or None
        
        Time complexity: O(1)
        """
        try:
            cache_key = f"explanation:{incident_id}"
            cached = await self.redis_client.get(cache_key)
            
            if cached:
                return json.loads(cached)
            
            return None
        
        except Exception as e:
            logger.warning(f"Cache read failed: {e}")
            return None
    
    async def _cache_explanation(self, incident_id: str, explanation: Dict[str, Any]):
        """
        Cache explanation in Redis.
        
        Args:
            incident_id: Incident UUID
            explanation: Explanation dictionary
        
        Time complexity: O(1)
        """
        try:
            cache_key = f"explanation:{incident_id}"
            await self.redis_client.setex(
                cache_key,
                settings.cache_ttl,
                json.dumps(explanation)
            )
        
        except Exception as e:
            logger.warning(f"Cache write failed: {e}")
    
    async def _track_token_usage(
        self,
        tenant_id: str,
        *texts: str
    ):
        """
        Track token usage per tenant for billing.
        
        Args:
            tenant_id: Tenant UUID
            texts: Text strings to count tokens for
        
        Time complexity: O(n) where n is total text length
        """
        try:
            total_tokens = sum([
                await self.llm_client.count_tokens(text)
                for text in texts
            ])
            
            # Increment daily counter
            from datetime import datetime
            date_key = datetime.utcnow().strftime("%Y-%m-%d")
            usage_key = f"token_usage:{tenant_id}:{date_key}"
            
            await self.redis_client.incrby(usage_key, total_tokens)
            await self.redis_client.expire(usage_key, 86400 * 7)  # Keep for 7 days
            
            logger.info(f"Tracked {total_tokens} tokens for tenant {tenant_id}")
        
        except Exception as e:
            logger.warning(f"Failed to track token usage: {e}")
    
    async def check_rate_limit(self, tenant_id: str) -> bool:
        """
        Check if tenant has exceeded rate limits.
        
        Args:
            tenant_id: Tenant UUID
        
        Returns:
            True if within limits, False if exceeded
        
        Time complexity: O(1)
        """
        try:
            from datetime import datetime
            date_key = datetime.utcnow().strftime("%Y-%m-%d")
            usage_key = f"token_usage:{tenant_id}:{date_key}"
            
            usage = await self.redis_client.get(usage_key)
            usage = int(usage) if usage else 0
            
            if usage >= settings.max_tokens_per_tenant_per_day:
                logger.warning(f"Tenant {tenant_id} exceeded daily token limit: {usage}")
                return False
            
            return True
        
        except Exception as e:
            logger.error(f"Failed to check rate limit: {e}")
            return True  # Fail open
    
    async def cleanup(self):
        """Cleanup connections"""
        self.db_session.close()
        
        if self.redis_client:
            await self.redis_client.close()
        
        if self.llm_client:
            await self.llm_client.close()

from neo4j import GraphDatabase
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from kafka import KafkaConsumer
import yaml
import logging
import json
from pathlib import Path
from typing import List, Dict, Optional, Set
from datetime import datetime
import uuid
from collections import defaultdict

from config import settings

logging.basicConfig(
    level=settings.log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class EventDrivenDetector:
    """
    Event-driven detection engine that triggers on graph updates.
    
    Architecture:
    - Consumes graph update events from Kafka
    - Evaluates detection rules against affected subgraphs
    - Creates incidents only when patterns match
    - Maintains detection state to avoid duplicate alerts
    
    Performance:
    - Processes events in batches (100 events)
    - Evaluates only rules relevant to event types
    - Deduplicates incidents within time window
    
    Time complexity: O(n * r) where n is events, r is relevant rules
    """
    
    def __init__(self):
        """Initialize detector with database connections and rules"""
        # PostgreSQL for incident storage
        engine = create_engine(settings.database_url)
        Session = sessionmaker(bind=engine)
        self.db_session = Session()
        
        # Neo4j admin connection
        self.neo4j_admin = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_admin_user, settings.neo4j_admin_password)
        )
        
        # Kafka consumer for graph updates
        self.consumer = KafkaConsumer(
            'graph.updates',
            bootstrap_servers=settings.kafka_bootstrap_servers,
            group_id='detection-engine',
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            auto_offset_reset='latest',
            enable_auto_commit=True,
            max_poll_records=100
        )
        
        # Load detection rules
        self.rules = self._load_rules()
        
        # Build rule index by relationship type for fast lookup
        self.rule_index = self._build_rule_index()
        
        # Recent detections cache (for deduplication)
        self.recent_detections: Dict[str, Set[str]] = defaultdict(set)
        
        # Metrics
        self.events_processed = 0
        self.detections_triggered = 0
        self.incidents_created = 0
        
        logger.info(
            f"Initialized EventDrivenDetector with {len(self.rules)} rules, "
            f"indexed {sum(len(v) for v in self.rule_index.values())} rule mappings"
        )
    
    def _load_rules(self) -> List[Dict]:
        """
        Load detection rules from YAML files.
        
        Returns:
            List of rule dictionaries
        
        Time complexity: O(n) where n is number of rule files
        """
        rules = []
        rules_path = Path(settings.rules_directory)
        
        if not rules_path.exists():
            logger.warning(f"Rules directory not found: {rules_path}")
            return rules
        
        for rule_file in rules_path.glob("*.yaml"):
            try:
                with open(rule_file, 'r') as f:
                    rule = yaml.safe_load(f)
                    rules.append(rule)
                    logger.info(f"Loaded rule: {rule['rule_id']} - {rule['name']}")
            except Exception as e:
                logger.error(f"Failed to load rule {rule_file}: {e}")
        
        return rules
    
    def _build_rule_index(self) -> Dict[str, List[Dict]]:
        """
        Build index of rules by relationship type for efficient lookup.
        
        Returns:
            Dictionary mapping relationship types to relevant rules
        
        Time complexity: O(n * m) where n is rules, m is triggers per rule
        """
        index = defaultdict(list)
        
        for rule in self.rules:
            # Extract relationship types from rule triggers
            triggers = rule.get('triggers', [])
            
            if not triggers:
                # Rules without triggers apply to all relationship types
                index['*'].append(rule)
            else:
                for trigger in triggers:
                    rel_type = trigger.get('relationship_type')
                    if rel_type:
                        index[rel_type].append(rule)
        
        return dict(index)
    
    def run(self):
        """
        Main event loop - consume graph updates and trigger detections.
        
        This is the primary entry point for the service.
        
        Time complexity: O(∞) - runs indefinitely
        """
        logger.info("Starting event-driven detection loop")
        
        try:
            for message in self.consumer:
                try:
                    event = message.value
                    self._process_graph_event(event)
                    self.events_processed += 1
                    
                    # Log metrics periodically
                    if self.events_processed % 1000 == 0:
                        logger.info(
                            f"Processed {self.events_processed} events, "
                            f"triggered {self.detections_triggered} detections, "
                            f"created {self.incidents_created} incidents"
                        )
                
                except Exception as e:
                    logger.error(f"Failed to process event: {e}", exc_info=True)
        
        except KeyboardInterrupt:
            logger.info("Received shutdown signal")
        finally:
            self._cleanup()
    
    def _process_graph_event(self, event: Dict):
        """
        Process single graph update event.
        
        Args:
            event: Graph update event with relationship data
        
        Time complexity: O(r) where r is number of relevant rules
        """
        tenant_id = event.get('tenant_id')
        relationship_type = event.get('relationship_type')
        
        if not tenant_id or not relationship_type:
            logger.warning(f"Invalid graph event: missing tenant_id or relationship_type")
            return
        
        # Get relevant rules for this relationship type
        relevant_rules = self._get_relevant_rules(relationship_type)
        
        if not relevant_rules:
            return
        
        # Evaluate each relevant rule
        for rule in relevant_rules:
            try:
                matches = self._evaluate_rule(tenant_id, rule, event)
                
                if matches and len(matches) >= rule.get('threshold', 1):
                    # Check if this detection is duplicate
                    detection_key = self._get_detection_key(tenant_id, rule, matches)
                    
                    if not self._is_duplicate_detection(tenant_id, detection_key):
                        incident = self._create_incident(tenant_id, rule, matches, event)
                        
                        if incident:
                            self.incidents_created += 1
                            self.detections_triggered += 1
                            
                            # Mark as detected
                            self.recent_detections[tenant_id].add(detection_key)
                            
                            logger.info(
                                f"Created incident {incident.incident_id} for tenant {tenant_id}: "
                                f"{rule['name']}"
                            )
            
            except Exception as e:
                logger.error(f"Failed to evaluate rule {rule['rule_id']}: {e}", exc_info=True)
    
    def _get_relevant_rules(self, relationship_type: str) -> List[Dict]:
        """
        Get rules relevant to relationship type.
        
        Args:
            relationship_type: Type of relationship created
        
        Returns:
            List of relevant rules
        
        Time complexity: O(1) - dictionary lookup
        """
        rules = []
        
        # Get rules specific to this relationship type
        if relationship_type in self.rule_index:
            rules.extend(self.rule_index[relationship_type])
        
        # Get rules that apply to all types
        if '*' in self.rule_index:
            rules.extend(self.rule_index['*'])
        
        return rules
    
    def _evaluate_rule(
        self,
        tenant_id: str,
        rule: Dict,
        trigger_event: Dict
    ) -> List[Dict]:
        """
        Evaluate detection rule against tenant graph.
        
        Args:
            tenant_id: Tenant UUID
            rule: Detection rule
            trigger_event: Event that triggered evaluation
        
        Returns:
            List of matches (graph query results)
        
        Security: Uses parameterized queries
        Time complexity: O(n) where n is graph size (depends on query)
        """
        try:
            driver = self._get_tenant_driver(tenant_id)
            database = self._get_tenant_database(tenant_id)
            
            if not driver or not database:
                return []
            
            with driver.session(database=database) as session:
                # Execute Cypher query with context from trigger event
                params = {
                    'tenant_id': tenant_id,
                    'lookback_window': settings.lookback_window * 1000000,
                    'source_entity_id': trigger_event.get('source_entity_id'),
                    'target_entity_id': trigger_event.get('target_entity_id'),
                    'relationship_id': trigger_event.get('relationship_id')
                }
                
                result = session.run(rule['query'], **params)
                matches = [dict(record) for record in result]
                
                if matches:
                    logger.debug(
                        f"Rule {rule['rule_id']} matched {len(matches)} times for tenant {tenant_id}"
                    )
                
                return matches
        
        except Exception as e:
            logger.error(f"Failed to execute rule {rule['rule_id']} for tenant {tenant_id}: {e}")
            return []
    
    def _get_detection_key(
        self,
        tenant_id: str,
        rule: Dict,
        matches: List[Dict]
    ) -> str:
        """
        Generate unique key for detection to enable deduplication.
        
        Args:
            tenant_id: Tenant UUID
            rule: Detection rule
            matches: Query matches
        
        Returns:
            Detection key (hash)
        
        Time complexity: O(n) where n is number of matches
        """
        # Extract entity IDs from matches
        entity_ids = set()
        for match in matches:
            for key, value in match.items():
                if key.endswith('_id') and value:
                    entity_ids.add(str(value))
        
        # Create deterministic key
        key_parts = [
            tenant_id,
            rule['rule_id'],
            ','.join(sorted(entity_ids))
        ]
        
        return '|'.join(key_parts)
    
    def _is_duplicate_detection(self, tenant_id: str, detection_key: str) -> bool:
        """
        Check if detection is duplicate within time window.
        
        Args:
            tenant_id: Tenant UUID
            detection_key: Detection key
        
        Returns:
            True if duplicate, False otherwise
        
        Time complexity: O(1) - set lookup
        """
        # Check if detection exists in recent cache
        if detection_key in self.recent_detections[tenant_id]:
            return True
        
        # Cleanup old detections periodically
        if len(self.recent_detections[tenant_id]) > 10000:
            self.recent_detections[tenant_id].clear()
        
        return False
    
    def _create_incident(
        self,
        tenant_id: str,
        rule: Dict,
        matches: List[Dict],
        trigger_event: Dict
    ) -> Optional[object]:
        """
        Create incident record in PostgreSQL.
        
        Args:
            tenant_id: Tenant UUID
            rule: Detection rule that matched
            matches: List of graph query results
            trigger_event: Event that triggered detection
        
        Returns:
            Incident object or None
        
        Security: Uses ORM to prevent SQL injection
        Time complexity: O(1) - single database insert
        """
        try:
            import sys
            sys.path.append('../../services/control-plane')
            from models.incident import Incident
            
            # Extract event IDs from matches
            event_chain = []
            for match in matches:
                if 'event_id' in match:
                    event_chain.append(match['event_id'])
            
            # Add trigger event
            if trigger_event.get('event_id'):
                event_chain.insert(0, trigger_event['event_id'])
            
            # Create incident
            incident = Incident(
                tenant_id=uuid.UUID(tenant_id),
                severity=rule['severity'],
                status='new',
                attack_pattern=rule['name'],
                mitre_technique=rule.get('mitre_technique'),
                event_chain=event_chain[:20],  # Limit to first 20 events
                graph_snapshot={'matches': matches[:10], 'trigger': trigger_event},
                ai_summary=None  # Will be generated on-demand
            )
            
            self.db_session.add(incident)
            self.db_session.commit()
            self.db_session.refresh(incident)
            
            return incident
        
        except Exception as e:
            self.db_session.rollback()
            logger.error(f"Failed to create incident: {e}", exc_info=True)
            return None
    
    def _get_tenant_driver(self, tenant_id: str):
        """Get Neo4j driver (reuses admin connection)"""
        return self.neo4j_admin
    
    def _get_tenant_database(self, tenant_id: str) -> Optional[str]:
        """Get Neo4j database name for tenant"""
        try:
            import sys
            sys.path.append('../../services/control-plane')
            from models.tenant import Tenant
            
            tenant = self.db_session.query(Tenant).filter(
                Tenant.tenant_id == tenant_id
            ).first()
            
            if not tenant:
                return None
            
            return tenant.settings.get('neo4j_database')
        except Exception as e:
            logger.error(f"Failed to get database for tenant {tenant_id}: {e}")
            return None
    
    def _cleanup(self):
        """Cleanup connections on shutdown"""
        logger.info("Cleaning up connections")
        
        self.consumer.close()
        self.db_session.close()
        self.neo4j_admin.close()
        
        logger.info("Cleanup complete")


def main():
    """Main entry point"""
    detector = EventDrivenDetector()
    detector.run()


if __name__ == "__main__":
    main()

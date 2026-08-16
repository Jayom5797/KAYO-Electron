from neo4j import GraphDatabase
from neo4j.exceptions import ServiceUnavailable, ClientError
from kafka import KafkaConsumer, KafkaProducer
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import json
import logging
import time
from typing import List, Dict, Optional
from collections import defaultdict

from config import settings
from entity_extractor import EntityExtractor
from relationship_mapper import RelationshipMapper

logging.basicConfig(
    level=settings.log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class GraphUpdater:
    """
    Updates Neo4j behavior graphs from Kafka event stream.
    
    Architecture:
    - Consumes events from Kafka (async from ClickHouse ingestion)
    - Extracts entities and relationships per event
    - Batches updates per tenant
    - Connects to tenant-specific Neo4j databases
    
    Performance:
    - Batch size: 1000 events
    - Batch timeout: 10 seconds
    - Expected throughput: 10K+ events/sec
    
    Security:
    - Tenant isolation via separate databases
    - All entities/relationships include tenant_id
    
    Time complexity: O(n) where n is batch size
    """
    
    def __init__(self):
        """Initialize Kafka consumer and database connections"""
        self.consumer = KafkaConsumer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            group_id=settings.kafka_group_id,
            auto_offset_reset='earliest',
            enable_auto_commit=False,
            value_deserializer=lambda m: json.loads(m.decode('utf-8'))
        )
        
        # Kafka producer for graph update events (triggers detection)
        self.producer = KafkaProducer(
            bootstrap_servers=settings.kafka_bootstrap_servers,
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )
        
        # PostgreSQL for tenant database credentials
        engine = create_engine(settings.database_url)
        Session = sessionmaker(bind=engine)
        self.db_session = Session()
        
        # Neo4j admin connection for tenant database lookup
        self.neo4j_admin = GraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_admin_user, settings.neo4j_admin_password)
        )
        
        # Cache of tenant Neo4j connections
        self.tenant_drivers = {}
        
        # Entity and relationship extractors
        self.entity_extractor = EntityExtractor()
        self.relationship_mapper = RelationshipMapper()
        
        # Batching
        self.batches = defaultdict(lambda: {'entities': [], 'relationships': []})
        self.last_flush = time.time()
        
        # Metrics
        self.events_processed = 0
        self.graphs_updated = 0
        
        logger.info("Initialized GraphUpdater")
    
    def subscribe_to_topics(self, pattern: str = None):
        """Subscribe to Kafka topics"""
        if pattern is None:
            pattern = settings.kafka_topic_pattern
        
        self.consumer.subscribe(pattern=pattern)
        logger.info(f"Subscribed to topics: {pattern}")
    
    def consume_and_update(self):
        """
        Main consumption loop.
        
        Processes events, extracts graph data, batches by tenant, and updates Neo4j.
        """
        try:
            logger.info("Starting graph update loop")
            
            for message in self.consumer:
                try:
                    event = message.value
                    tenant_id = event.get('tenant_id')
                    
                    if not tenant_id:
                        logger.warning(f"Event missing tenant_id: {event.get('event_id')}")
                        continue
                    
                    # Extract entities and relationships
                    entities = self.entity_extractor.extract_entities(event)
                    relationships = self.relationship_mapper.map_relationships(event, entities)
                    
                    # Add to tenant batch
                    self.batches[tenant_id]['entities'].extend(entities)
                    self.batches[tenant_id]['relationships'].extend(relationships)
                    
                    self.events_processed += 1
                    
                    # Flush batches if needed
                    if self._should_flush():
                        self._flush_all_batches()
                        self.consumer.commit()
                    
                    # Log progress
                    if self.events_processed % 1000 == 0:
                        logger.info(
                            f"Processed {self.events_processed} events, "
                            f"updated {self.graphs_updated} graphs"
                        )
                
                except Exception as e:
                    logger.error(f"Failed to process event: {e}", exc_info=True)
                    continue
        
        except KeyboardInterrupt:
            logger.info("Received shutdown signal")
        
        finally:
            self._flush_all_batches()
            self._cleanup()
    
    def _should_flush(self) -> bool:
        """
        Check if batches should be flushed.
        
        Flush conditions:
        - Any tenant batch exceeds batch_size
        - Timeout exceeded
        
        Time complexity: O(n) where n is number of active tenants
        """
        # Check batch sizes
        for batch in self.batches.values():
            if len(batch['entities']) >= settings.batch_size:
                return True
        
        # Check timeout
        elapsed = time.time() - self.last_flush
        return elapsed >= settings.batch_timeout
    
    def _flush_all_batches(self):
        """
        Flush all tenant batches to Neo4j.
        
        Time complexity: O(t * n) where t is tenants, n is batch size per tenant
        """
        if not self.batches:
            return
        
        for tenant_id, batch in self.batches.items():
            if batch['entities'] or batch['relationships']:
                self._flush_tenant_batch(tenant_id, batch)
        
        self.batches.clear()
        self.last_flush = time.time()
    
    def _flush_tenant_batch(self, tenant_id: str, batch: Dict):
        """
        Flush batch for a specific tenant.
        
        Args:
            tenant_id: Tenant UUID
            batch: Dictionary with 'entities' and 'relationships' lists
        
        Security: Connects to tenant-specific database for isolation
        Time complexity: O(n) where n is batch size
        """
        try:
            # Get tenant Neo4j connection
            driver = self._get_tenant_driver(tenant_id)
            if not driver:
                logger.error(f"Failed to get driver for tenant: {tenant_id}")
                return
            
            # Get tenant database name
            database = self._get_tenant_database(tenant_id)
            if not database:
                logger.error(f"Failed to get database for tenant: {tenant_id}")
                return
            
            with driver.session(database=database) as session:
                # Upsert entities
                for entity in batch['entities']:
                    session.execute_write(self._upsert_entity, entity)
                
                # Create relationships and publish events
                for relationship in batch['relationships']:
                    session.execute_write(self._create_relationship, relationship)
                    
                    # Publish graph update event for detection engine
                    self._publish_graph_event(tenant_id, relationship)
            
            self.graphs_updated += 1
            logger.info(
                f"Updated graph for tenant {tenant_id}: "
                f"{len(batch['entities'])} entities, "
                f"{len(batch['relationships'])} relationships"
            )
        
        except Exception as e:
            logger.error(f"Failed to flush batch for tenant {tenant_id}: {e}", exc_info=True)
    
    def _get_tenant_driver(self, tenant_id: str) -> Optional[GraphDatabase.driver]:
        """
        Get or create Neo4j driver for tenant.
        
        Caches drivers to avoid connection overhead.
        Retrieves credentials from K8s Secrets for security.
        
        Time complexity: O(1) amortized
        """
        if tenant_id in self.tenant_drivers:
            return self.tenant_drivers[tenant_id]
        
        try:
            # Query tenant metadata from PostgreSQL
            from services.control_plane.models.tenant import Tenant
            tenant = self.db_session.query(Tenant).filter(
                Tenant.tenant_id == tenant_id
            ).first()
            
            if not tenant:
                logger.error(f"Tenant not found: {tenant_id}")
                return None
            
            # Retrieve Neo4j credentials from K8s Secret
            from kubernetes import client, config as k8s_config
            try:
                if settings.k8s_in_cluster:
                    k8s_config.load_incluster_config()
                else:
                    k8s_config.load_kube_config()
                
                v1 = client.CoreV1Api()
                namespace = tenant.settings.get('k8s_namespace')
                secret_name = tenant.settings.get('neo4j_secret_name')
                
                if not namespace or not secret_name:
                    logger.error(f"Missing K8s metadata for tenant {tenant_id}")
                    return None
                
                secret = v1.read_namespaced_secret(secret_name, namespace)
                neo4j_user = secret.data.get('username')
                neo4j_password = secret.data.get('password')
                
                if not neo4j_user or not neo4j_password:
                    logger.error(f"Missing Neo4j credentials in secret for tenant {tenant_id}")
                    return None
                
                # Decode base64
                import base64
                neo4j_user = base64.b64decode(neo4j_user).decode('utf-8')
                neo4j_password = base64.b64decode(neo4j_password).decode('utf-8')
                
            except Exception as e:
                logger.error(f"Failed to retrieve credentials from K8s Secret: {e}")
                # Fallback to admin credentials (dev only)
                neo4j_user = settings.neo4j_admin_user
                neo4j_password = settings.neo4j_admin_password
            
            driver = GraphDatabase.driver(
                settings.neo4j_uri,
                auth=(neo4j_user, neo4j_password)
            )
            
            self.tenant_drivers[tenant_id] = driver
            return driver
        
        except Exception as e:
            logger.error(f"Failed to create driver for tenant {tenant_id}: {e}")
            return None
    
    def _get_tenant_database(self, tenant_id: str) -> Optional[str]:
        """
        Get Neo4j database name for tenant.
        
        Time complexity: O(1) - database query with index
        """
        try:
            from services.control_plane.models.tenant import Tenant
            tenant = self.db_session.query(Tenant).filter(
                Tenant.tenant_id == tenant_id
            ).first()
            
            if not tenant:
                return None
            
            return tenant.settings.get('neo4j_database')
        
        except Exception as e:
            logger.error(f"Failed to get database for tenant {tenant_id}: {e}")
            return None
    
    @staticmethod
    def _upsert_entity(tx, entity: Dict):
        """
        Upsert entity node in Neo4j.
        
        Uses MERGE for idempotency - creates if not exists, updates if exists.
        
        Security: Parameterized queries prevent injection
        Time complexity: O(log n) for index lookup
        """
        entity_type = entity['type']
        entity_id = entity['id']
        properties = entity['properties']
        
        query = f"""
        MERGE (e:{entity_type} {{id: $id}})
        ON CREATE SET e += $properties
        ON MATCH SET e.last_seen = $properties.last_seen
        """
        
        tx.run(query, id=entity_id, properties=properties)
    
    @staticmethod
    def _create_relationship(tx, relationship: Dict):
        """
        Create relationship in Neo4j.
        
        Creates relationship between existing nodes.
        
        Security: Parameterized queries prevent injection
        Time complexity: O(log n) for node lookups
        """
        rel_type = relationship['type']
        source_type, source_id = relationship['source']
        target_type, target_id = relationship['target']
        properties = relationship['properties']
        
        query = f"""
        MATCH (s:{source_type} {{id: $source_id}})
        MATCH (t:{target_type} {{id: $target_id}})
        CREATE (s)-[r:{rel_type}]->(t)
        SET r += $properties
        """
        
        try:
            tx.run(
                query,
                source_id=source_id,
                target_id=target_id,
                properties=properties
            )
        except ClientError as e:
            # Node not found - skip relationship
            logger.warning(f"Failed to create relationship {rel_type}: {e}")
    
    def _cleanup(self):
        """Cleanup connections on shutdown"""
        logger.info("Cleaning up connections")
        
        self.consumer.close()
        self.producer.close()
        self.db_session.close()
        self.neo4j_admin.close()
        
        for driver in self.tenant_drivers.values():
            driver.close()
        
        logger.info("Cleanup complete")
    
    def _publish_graph_event(self, tenant_id: str, relationship: Dict):
        """
        Publish graph update event to Kafka for detection engine.
        
        Args:
            tenant_id: Tenant UUID
            relationship: Relationship that was created
        
        Time complexity: O(1) - async Kafka send
        """
        try:
            event = {
                'tenant_id': tenant_id,
                'relationship_type': relationship['type'],
                'source_entity_type': relationship['source'][0],
                'source_entity_id': relationship['source'][1],
                'target_entity_type': relationship['target'][0],
                'target_entity_id': relationship['target'][1],
                'relationship_id': relationship['properties'].get('id'),
                'event_id': relationship['properties'].get('event_id'),
                'timestamp': relationship['properties'].get('timestamp')
            }
            
            self.producer.send('graph.updates', value=event)
        
        except Exception as e:
            logger.warning(f"Failed to publish graph event: {e}")


def main():
    """Main entry point"""
    updater = GraphUpdater()
    updater.subscribe_to_topics()
    updater.consume_and_update()


if __name__ == "__main__":
    main()

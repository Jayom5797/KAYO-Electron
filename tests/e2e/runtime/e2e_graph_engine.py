"""
E2E Test Graph Engine Runner

Simplified graph engine that:
- Consumes from Kafka (telemetry.* topics)
- Extracts entities and relationships
- Writes directly to Neo4j default database (no multi-tenant DB lookup)
- Publishes graph.updates to Kafka for detection engine

This bypasses the K8s secret lookup for tenant credentials,
using the admin Neo4j connection directly. Suitable for E2E testing
where Neo4j Community (single database) is used.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../../services/graph-engine'))

from neo4j import GraphDatabase
from kafka import KafkaConsumer, KafkaProducer
import json
import logging
import time
from collections import defaultdict

from entity_extractor import EntityExtractor
from relationship_mapper import RelationshipMapper

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('e2e-graph-engine')

KAFKA_BOOTSTRAP = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
NEO4J_URI = os.environ.get('NEO4J_URI', 'bolt://localhost:7687')
NEO4J_USER = os.environ.get('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.environ.get('NEO4J_PASSWORD', 'kayo_e2e_password')
NEO4J_DATABASE = os.environ.get('NEO4J_DATABASE', 'neo4j')


def main():
    logger.info(f"Starting E2E Graph Engine")
    logger.info(f"  Kafka: {KAFKA_BOOTSTRAP}")
    logger.info(f"  Neo4j: {NEO4J_URI} (database={NEO4J_DATABASE})")

    # Connect to Neo4j
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    driver.verify_connectivity()
    logger.info("Neo4j connected OK")

    # Kafka consumer
    consumer = KafkaConsumer(
        bootstrap_servers=KAFKA_BOOTSTRAP.replace('"', '').strip('[]'),
        group_id='e2e-graph-engine',
        auto_offset_reset='earliest',
        enable_auto_commit=True,
        value_deserializer=lambda m: json.loads(m.decode('utf-8')),
        consumer_timeout_ms=30000  # Stop after 30s of no messages
    )
    consumer.subscribe(pattern='telemetry\\..*')
    logger.info("Kafka consumer subscribed to telemetry.* topics")

    # Kafka producer for graph.updates
    producer = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP.replace('"', '').strip('[]'),
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )

    entity_extractor = EntityExtractor()
    relationship_mapper = RelationshipMapper()

    events_processed = 0
    entities_created = 0
    relationships_created = 0

    try:
        for message in consumer:
            event = message.value
            tenant_id = event.get('tenant_id')

            if not tenant_id:
                continue

            # Extract entities and relationships
            entities = entity_extractor.extract_entities(event)
            relationships = relationship_mapper.map_relationships(event, entities)

            # Write to Neo4j
            with driver.session(database=NEO4J_DATABASE) as session:
                for entity in entities:
                    session.execute_write(_upsert_entity, entity)
                    entities_created += 1

                for rel in relationships:
                    session.execute_write(_create_relationship, rel)
                    relationships_created += 1

                    # Publish graph update for detection engine
                    graph_event = {
                        'tenant_id': tenant_id,
                        'relationship_type': rel['type'],
                        'source_entity_type': rel['source'][0],
                        'source_entity_id': rel['source'][1],
                        'target_entity_type': rel['target'][0],
                        'target_entity_id': rel['target'][1],
                        'relationship_id': rel['properties'].get('event_id'),
                        'event_id': rel['properties'].get('event_id'),
                        'timestamp': rel['properties'].get('timestamp'),
                    }
                    producer.send('graph.updates', value=graph_event)

            events_processed += 1
            logger.info(f"Processed event {events_processed}: {len(entities)} entities, {len(relationships)} relationships")

    except KeyboardInterrupt:
        logger.info("Shutting down")
    finally:
        consumer.close()
        producer.close()
        driver.close()
        logger.info(f"Done: {events_processed} events, {entities_created} entities, {relationships_created} relationships")


def _upsert_entity(tx, entity):
    """Upsert entity node in Neo4j."""
    entity_type = entity['type']
    entity_id = entity['id']
    properties = entity['properties']

    query = f"""
    MERGE (e:{entity_type} {{id: $id}})
    ON CREATE SET e += $properties
    ON MATCH SET e.last_seen = $last_seen
    """
    tx.run(query, id=entity_id, properties=properties, last_seen=properties.get('last_seen', properties.get('first_seen')))


def _create_relationship(tx, relationship):
    """Create relationship in Neo4j."""
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
        tx.run(query, source_id=source_id, target_id=target_id, properties=properties)
    except Exception as e:
        logger.warning(f"Failed to create relationship {rel_type}: {e}")


if __name__ == '__main__':
    main()

"""
E2E Test Detection Engine Runner

Simplified detection engine that:
- Consumes graph.updates from Kafka
- Evaluates MITRE ATT&CK rules against Neo4j
- Creates incidents in PostgreSQL

Uses admin Neo4j connection (single database for E2E testing).
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../../services/detection-engine'))

from neo4j import GraphDatabase
from kafka import KafkaConsumer
import psycopg2
import yaml
import json
import uuid
import logging
import time
from pathlib import Path
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('e2e-detection-engine')

KAFKA_BOOTSTRAP = os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
NEO4J_URI = os.environ.get('NEO4J_URI', 'bolt://localhost:7687')
NEO4J_USER = os.environ.get('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.environ.get('NEO4J_PASSWORD', 'kayo_e2e_password')
NEO4J_DATABASE = os.environ.get('NEO4J_DATABASE', 'neo4j')
DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://kayo:kayo_e2e_password@localhost:5433/kayo_e2e')
RULES_DIR = os.environ.get('RULES_DIR', str(Path(__file__).parent.parent.parent / 'packages' / 'security-rules'))
LOOKBACK_WINDOW = int(os.environ.get('LOOKBACK_WINDOW', '3600'))


def load_rules(rules_dir):
    """Load YAML detection rules."""
    rules = []
    for rule_file in Path(rules_dir).glob("*.yaml"):
        try:
            with open(rule_file) as f:
                rule = yaml.safe_load(f)
                rules.append(rule)
                logger.info(f"Loaded rule: {rule['rule_id']} - {rule['name']}")
        except Exception as e:
            logger.error(f"Failed to load {rule_file}: {e}")
    return rules


def evaluate_rule(driver, database, rule, event):
    """Evaluate a detection rule against the Neo4j graph."""
    try:
        with driver.session(database=database) as session:
            params = {
                'lookback_window': LOOKBACK_WINDOW * 1000000,  # microseconds
                'source_entity_id': event.get('source_entity_id'),
                'target_entity_id': event.get('target_entity_id'),
                'relationship_id': event.get('relationship_id'),
            }
            result = session.run(rule['query'], **params)
            matches = [dict(record) for record in result]
            return matches
    except Exception as e:
        logger.error(f"Rule {rule['rule_id']} evaluation failed: {e}")
        return []


def create_incident(conn, tenant_id, rule, matches, event):
    """Create an incident in PostgreSQL."""
    incident_id = str(uuid.uuid4())
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO incidents (incident_id, tenant_id, severity, status, attack_pattern, 
                                   mitre_technique, event_chain, graph_snapshot, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s::uuid[], %s, NOW(), NOW())
        """, (
            incident_id,
            tenant_id,
            rule['severity'],
            'new',
            rule['name'],
            rule.get('mitre_technique'),
            '{' + event.get('event_id', '') + '}' if event.get('event_id') else '{}',
            json.dumps({'matches': matches[:5], 'trigger_event': event}),
        ))
        conn.commit()
        logger.info(f"INCIDENT CREATED: {incident_id} | Rule: {rule['rule_id']} | Severity: {rule['severity']} | MITRE: {rule.get('mitre_technique')}")
        return incident_id
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to create incident: {e}")
        return None


def main():
    logger.info("=== E2E Detection Engine ===")
    logger.info(f"  Kafka: {KAFKA_BOOTSTRAP}")
    logger.info(f"  Neo4j: {NEO4J_URI} (database={NEO4J_DATABASE})")
    logger.info(f"  PostgreSQL: {DATABASE_URL.split('@')[1] if '@' in DATABASE_URL else DATABASE_URL}")
    logger.info(f"  Rules: {RULES_DIR}")

    # Load rules
    rules = load_rules(RULES_DIR)
    logger.info(f"Loaded {len(rules)} detection rules")

    # Build rule index by trigger relationship type
    rule_index = defaultdict(list)
    for rule in rules:
        triggers = rule.get('triggers', [])
        if not triggers:
            rule_index['*'].append(rule)
        else:
            for trigger in triggers:
                rel_type = trigger.get('relationship_type')
                if rel_type:
                    rule_index[rel_type].append(rule)
    logger.info(f"Rule index: {dict((k, len(v)) for k, v in rule_index.items())}")

    # Connect Neo4j
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    driver.verify_connectivity()
    logger.info("Neo4j connected")

    # Connect PostgreSQL
    conn = psycopg2.connect(DATABASE_URL)
    logger.info("PostgreSQL connected")

    # Kafka consumer for graph.updates
    consumer = KafkaConsumer(
        'graph.updates',
        bootstrap_servers=KAFKA_BOOTSTRAP,
        group_id='e2e-detection-engine',
        auto_offset_reset='earliest',
        enable_auto_commit=True,
        value_deserializer=lambda m: json.loads(m.decode('utf-8')),
        consumer_timeout_ms=30000  # 30s timeout
    )
    logger.info("Kafka consumer started on graph.updates")

    # Track detections to avoid duplicates
    detected_keys = set()
    events_processed = 0
    detections = 0

    try:
        for message in consumer:
            event = message.value
            tenant_id = event.get('tenant_id')
            rel_type = event.get('relationship_type')
            events_processed += 1

            if not tenant_id or not rel_type:
                continue

            # Get relevant rules
            relevant_rules = rule_index.get(rel_type, []) + rule_index.get('*', [])
            if not relevant_rules:
                continue

            # Evaluate each rule
            for rule in relevant_rules:
                matches = evaluate_rule(driver, NEO4J_DATABASE, rule, event)
                if matches and len(matches) >= rule.get('threshold', 1):
                    # Dedup key
                    dedup_key = f"{tenant_id}|{rule['rule_id']}|{event.get('source_entity_id')}"
                    if dedup_key in detected_keys:
                        logger.info(f"  Duplicate detection skipped: {rule['rule_id']}")
                        continue
                    detected_keys.add(dedup_key)

                    # Create incident
                    incident_id = create_incident(conn, tenant_id, rule, matches, event)
                    if incident_id:
                        detections += 1
                        logger.info(f"  Matches: {len(matches)}, Risk: {rule.get('risk_score')}")

    except KeyboardInterrupt:
        logger.info("Shutting down")
    finally:
        consumer.close()
        driver.close()
        conn.close()
        logger.info(f"Done: {events_processed} events processed, {detections} detections triggered")


if __name__ == '__main__':
    main()

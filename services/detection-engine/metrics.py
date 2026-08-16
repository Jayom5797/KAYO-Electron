from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
import logging

logger = logging.getLogger(__name__)

# Detection Metrics
detections_triggered_total = Counter(
    'kayo_detections_triggered_total',
    'Total detections triggered',
    ['tenant_id', 'rule_id', 'severity']
)

detection_evaluation_duration_seconds = Histogram(
    'kayo_detection_evaluation_duration_seconds',
    'Detection rule evaluation duration',
    ['tenant_id', 'rule_id']
)

detection_latency_seconds = Histogram(
    'kayo_detection_latency_seconds',
    'Time from event to detection',
    ['tenant_id']
)

# Incident Metrics
incidents_created_total = Counter(
    'kayo_incidents_created_total',
    'Total incidents created',
    ['tenant_id', 'severity', 'mitre_technique']
)

incidents_deduplicated_total = Counter(
    'kayo_incidents_deduplicated_total',
    'Total incidents deduplicated',
    ['tenant_id', 'rule_id']
)

# Rule Metrics
rules_loaded_total = Gauge(
    'kayo_detection_rules_loaded_total',
    'Total detection rules loaded'
)

rule_evaluation_errors_total = Counter(
    'kayo_detection_rule_evaluation_errors_total',
    'Rule evaluation errors',
    ['tenant_id', 'rule_id', 'error_type']
)

# Kafka Consumer Metrics
kafka_consumer_lag = Gauge(
    'kayo_detection_kafka_consumer_lag',
    'Kafka consumer lag',
    ['topic', 'partition']
)

graph_events_consumed_total = Counter(
    'kayo_detection_graph_events_consumed_total',
    'Total graph events consumed',
    ['tenant_id']
)

# Neo4j Query Metrics
neo4j_query_duration_seconds = Histogram(
    'kayo_detection_neo4j_query_duration_seconds',
    'Neo4j query duration for detection',
    ['tenant_id', 'rule_id']
)

# Attack Path Metrics
attack_paths_reconstructed_total = Counter(
    'kayo_attack_paths_reconstructed_total',
    'Total attack paths reconstructed',
    ['tenant_id']
)

attack_path_confidence_score = Histogram(
    'kayo_attack_path_confidence_score',
    'Attack path confidence scores',
    ['tenant_id']
)

from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
import logging

logger = logging.getLogger(__name__)

# Event Processing Metrics
events_processed_total = Counter(
    'kayo_graph_events_processed_total',
    'Total events processed',
    ['tenant_id', 'event_type']
)

events_failed_total = Counter(
    'kayo_graph_events_failed_total',
    'Total events failed',
    ['tenant_id', 'error_type']
)

event_processing_duration_seconds = Histogram(
    'kayo_graph_event_processing_duration_seconds',
    'Event processing duration',
    ['tenant_id']
)

# Entity Metrics
entities_created_total = Counter(
    'kayo_graph_entities_created_total',
    'Total entities created',
    ['tenant_id', 'entity_type']
)

# Relationship Metrics
relationships_created_total = Counter(
    'kayo_graph_relationships_created_total',
    'Total relationships created',
    ['tenant_id', 'relationship_type']
)

# Batch Metrics
batch_size = Histogram(
    'kayo_graph_batch_size',
    'Batch size for graph updates',
    ['tenant_id']
)

batch_flush_duration_seconds = Histogram(
    'kayo_graph_batch_flush_duration_seconds',
    'Batch flush duration',
    ['tenant_id']
)

# Kafka Consumer Metrics
kafka_consumer_lag = Gauge(
    'kayo_graph_kafka_consumer_lag',
    'Kafka consumer lag',
    ['topic', 'partition']
)

kafka_messages_consumed_total = Counter(
    'kayo_graph_kafka_messages_consumed_total',
    'Total Kafka messages consumed',
    ['topic']
)

# Neo4j Metrics
neo4j_query_duration_seconds = Histogram(
    'kayo_graph_neo4j_query_duration_seconds',
    'Neo4j query duration',
    ['operation', 'tenant_id']
)

neo4j_connection_errors_total = Counter(
    'kayo_graph_neo4j_connection_errors_total',
    'Neo4j connection errors',
    ['tenant_id']
)

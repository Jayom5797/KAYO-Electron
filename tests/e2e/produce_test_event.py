"""Produces a synthetic telemetry event to Kafka for E2E runtime pipeline testing."""
from kafka import KafkaProducer
import json
import uuid
import time

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

event_id = str(uuid.uuid4())
tenant_id = '8f5fda95-1ba7-499b-983f-c308c49d3061'

event = {
    'event_id': event_id,
    'tenant_id': tenant_id,
    'timestamp': int(time.time() * 1000000),
    'source_type': 'application',
    'event': {
        'category': 'process',
        'type': 'start',
        'action': 'process_started',
        'outcome': 'success'
    },
    'user': {'id': str(uuid.uuid4()), 'name': 'test-user'},
    'process': {
        'id': str(uuid.uuid4()),
        'name': 'sudo',
        'pid': 1234,
        'command_line': 'sudo su root',
        'parent_id': str(uuid.uuid4())
    },
    'host': {'id': str(uuid.uuid4()), 'hostname': 'kayo-e2e-host', 'ip': '10.0.1.5'},
    'container': {'id': 'abc123def', 'name': 'test-container', 'image': 'nginx:latest'},
    'network': {},
    'file': {},
    'deployment_name': 'e2e-test-app',
    'namespace': 'tenant-e2e',
    'risk_score': 80,
    'tags': ['e2e-test', 'synthetic'],
}

result = producer.send('telemetry.e2e.application', value=event).get(timeout=10)
producer.close()

print(f'KAFKA EVENT PRODUCED')
print(f'  topic: {result.topic}')
print(f'  partition: {result.partition}')
print(f'  offset: {result.offset}')
print(f'  event_id: {event_id}')
print(f'  tenant_id: {tenant_id}')

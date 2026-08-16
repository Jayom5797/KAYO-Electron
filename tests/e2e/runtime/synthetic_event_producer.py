"""
Synthetic Event Producer for KAYO Runtime Detection E2E Testing

Produces the minimum event sequence to trigger the T1078 Privilege Escalation rule:
1. Authentication event: User authenticates to Host
2. Process event: 'sudo' process spawns on the same Host

These events travel through: Kafka → Graph Engine → Neo4j → Detection Engine → Incident

Usage:
  python synthetic_event_producer.py
"""
import json
import uuid
import time
import sys
from kafka import KafkaProducer

KAFKA_BOOTSTRAP = 'localhost:9092'
TENANT_ID = '8f5fda95-1ba7-499b-983f-c308c49d3061'
TOPIC = 'telemetry.e2e.application'

# Fixed IDs for correlation
USER_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'e2e-test-user'))
HOST_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'e2e-test-host'))
PROCESS_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'e2e-sudo-process'))
PARENT_PROCESS_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, 'e2e-bash-parent'))


def create_auth_event():
    """Event 1: User authenticates to host (creates User→AUTHENTICATED_TO→Host)"""
    return {
        'event_id': str(uuid.uuid4()),
        'tenant_id': TENANT_ID,
        'timestamp': int(time.time() * 1000000),
        'source_type': 'application',
        'event': {
            'category': 'authentication',
            'type': 'start',
            'action': 'login',
            'outcome': 'success'
        },
        'user': {'id': USER_ID, 'name': 'e2e-attacker'},
        'process': {'id': str(uuid.uuid4()), 'name': 'sshd', 'pid': 1000},
        'host': {'id': HOST_ID, 'hostname': 'e2e-target-host', 'ip': '10.0.1.50'},
        'container': {},
        'network': {},
        'file': {},
        'risk_score': 30,
        'tags': ['e2e-test', 'synthetic', 'auth'],
    }


def create_sudo_event():
    """Event 2: sudo process spawns on the host (creates Process{sudo}→RUNS_ON→Host)"""
    return {
        'event_id': str(uuid.uuid4()),
        'tenant_id': TENANT_ID,
        'timestamp': int(time.time() * 1000000),
        'source_type': 'application',
        'event': {
            'category': 'process',
            'type': 'start',
            'action': 'process_started',
            'outcome': 'success'
        },
        'user': {'id': USER_ID, 'name': 'e2e-attacker'},
        'process': {
            'id': PROCESS_ID,
            'name': 'sudo',
            'pid': 2345,
            'command_line': 'sudo su root',
            'parent_id': PARENT_PROCESS_ID
        },
        'host': {'id': HOST_ID, 'hostname': 'e2e-target-host', 'ip': '10.0.1.50'},
        'container': {},
        'network': {},
        'file': {},
        'risk_score': 80,
        'tags': ['e2e-test', 'synthetic', 'privesc'],
    }


def main():
    print("=== KAYO Synthetic Event Producer ===")
    print(f"Kafka: {KAFKA_BOOTSTRAP}")
    print(f"Topic: {TOPIC}")
    print(f"Tenant: {TENANT_ID}")
    print(f"Rule target: T1078 Privilege Escalation via Sudo")
    print()

    producer = KafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )

    # Event 1: Authentication
    auth_event = create_auth_event()
    r1 = producer.send(TOPIC, value=auth_event).get(timeout=10)
    print(f"[1/2] Auth event sent: offset={r1.offset}, event_id={auth_event['event_id']}")

    # Brief pause to ensure ordering
    time.sleep(1)

    # Event 2: Sudo process
    sudo_event = create_sudo_event()
    r2 = producer.send(TOPIC, value=sudo_event).get(timeout=10)
    print(f"[2/2] Sudo event sent: offset={r2.offset}, event_id={sudo_event['event_id']}")

    producer.close()
    print()
    print("Events produced. Expected detection:")
    print(f"  Rule: T1078_privilege_escalation")
    print(f"  MITRE: T1078.003")
    print(f"  Severity: high")
    print(f"  Pattern: User '{auth_event['user']['name']}' → sudo on host '{sudo_event['host']['hostname']}'")


if __name__ == '__main__':
    main()

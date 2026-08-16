import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const eventIngestionRate = new Rate('event_ingestion_success');
const eventIngestionLatency = new Trend('event_ingestion_latency');
const eventsProcessed = new Counter('events_processed');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up to 100 VUs
    { duration: '5m', target: 100 },   // Stay at 100 VUs
    { duration: '2m', target: 500 },   // Ramp up to 500 VUs
    { duration: '5m', target: 500 },   // Stay at 500 VUs
    { duration: '2m', target: 1000 },  // Ramp up to 1000 VUs
    { duration: '5m', target: 1000 },  // Stay at 1000 VUs
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    'event_ingestion_success': ['rate>0.99'],  // 99% success rate
    'event_ingestion_latency': ['p(95)<1000'], // 95% under 1s
    'http_req_failed': ['rate<0.01'],          // <1% errors
  },
};

// Base URL - update for your environment
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const TENANT_ID = __ENV.TENANT_ID || '550e8400-e29b-41d4-a716-446655440000';

// Generate realistic security event
function generateSecurityEvent() {
  const timestamp = Date.now() * 1000; // microseconds
  const eventTypes = [
    'process_start',
    'network_connection',
    'file_access',
    'authentication',
    'privilege_escalation'
  ];
  
  const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
  
  const baseEvent = {
    event_id: `evt_${timestamp}_${Math.random().toString(36).substr(2, 9)}`,
    tenant_id: TENANT_ID,
    timestamp: timestamp,
    source_type: 'application',
    event: {
      category: 'security',
      type: eventType,
      action: 'detected',
      outcome: 'success'
    }
  };
  
  // Add type-specific fields
  switch(eventType) {
    case 'process_start':
      return {
        ...baseEvent,
        process: {
          pid: Math.floor(Math.random() * 65535),
          name: ['nginx', 'postgres', 'redis-server', 'node'][Math.floor(Math.random() * 4)],
          command_line: '/usr/bin/process --config /etc/config.conf',
          parent_id: `proc_${Math.floor(Math.random() * 1000)}`
        },
        host: {
          id: `host_${Math.floor(Math.random() * 100)}`,
          hostname: `web-server-${Math.floor(Math.random() * 10)}`,
          ip: `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
        },
        user: {
          name: ['root', 'www-data', 'postgres', 'app'][Math.floor(Math.random() * 4)]
        }
      };
      
    case 'network_connection':
      return {
        ...baseEvent,
        network: {
          source_ip: `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
          dest_ip: `172.16.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
          dest_port: [80, 443, 3306, 5432, 6379][Math.floor(Math.random() * 5)],
          protocol: 'tcp'
        },
        process: {
          pid: Math.floor(Math.random() * 65535),
          name: 'curl'
        },
        host: {
          id: `host_${Math.floor(Math.random() * 100)}`,
          hostname: `web-server-${Math.floor(Math.random() * 10)}`
        }
      };
      
    case 'file_access':
      return {
        ...baseEvent,
        file: {
          path: ['/etc/passwd', '/var/log/auth.log', '/home/user/.ssh/id_rsa'][Math.floor(Math.random() * 3)],
          hash: `sha256_${Math.random().toString(36).substr(2, 64)}`
        },
        process: {
          pid: Math.floor(Math.random() * 65535),
          name: 'cat'
        },
        user: {
          name: ['root', 'admin', 'user'][Math.floor(Math.random() * 3)]
        }
      };
      
    case 'authentication':
      return {
        ...baseEvent,
        user: {
          name: `user_${Math.floor(Math.random() * 1000)}`,
          id: `uid_${Math.floor(Math.random() * 10000)}`
        },
        host: {
          id: `host_${Math.floor(Math.random() * 100)}`,
          hostname: `auth-server-${Math.floor(Math.random() * 5)}`,
          ip: `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
        },
        event: {
          ...baseEvent.event,
          outcome: Math.random() > 0.1 ? 'success' : 'failure'
        }
      };
      
    default:
      return baseEvent;
  }
}

// Main test function
export default function() {
  // Generate batch of events (simulate Vector batch)
  const batchSize = 100;
  const events = [];
  
  for (let i = 0; i < batchSize; i++) {
    events.push(generateSecurityEvent());
  }
  
  // Send to telemetry ingestion API
  const payload = JSON.stringify({ events: events });
  
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  const response = http.post(
    `${BASE_URL}/api/telemetry/ingest`,
    payload,
    params
  );
  
  // Check response
  const success = check(response, {
    'status is 200 or 202': (r) => r.status === 200 || r.status === 202,
    'response time < 1s': (r) => r.timings.duration < 1000,
  });
  
  // Record metrics
  eventIngestionRate.add(success);
  eventIngestionLatency.add(response.timings.duration);
  eventsProcessed.add(batchSize);
  
  // Small delay to simulate realistic load
  sleep(0.1);
}

// Setup function - runs once per VU
export function setup() {
  console.log('Starting telemetry ingestion load test');
  console.log(`Target: 100K events/sec`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Tenant ID: ${TENANT_ID}`);
}

// Teardown function - runs once at end
export function teardown(data) {
  console.log('Load test completed');
  console.log('Check Prometheus for detailed metrics');
}

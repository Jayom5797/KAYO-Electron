import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Custom metrics
const detectionLatency = new Trend('detection_latency_ms');
const incidentsCreated = new Counter('incidents_created');
const eventsIngested = new Counter('events_ingested');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Ramp up slowly
    { duration: '5m', target: 10 },   // Sustained load
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    'detection_latency_ms': ['p(95)<5000'], // 95% under 5 seconds
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const TENANT_ID = __ENV.TENANT_ID || '550e8400-e29b-41d4-a716-446655440000';

// Generate attack pattern events
function generateAttackPattern() {
  const timestamp = Date.now() * 1000;
  const hostId = `host_${randomString(8)}`;
  const userId = `user_${randomString(8)}`;
  const processId = `proc_${randomString(8)}`;
  
  // Simulate privilege escalation attack pattern
  return [
    // 1. Initial authentication
    {
      event_id: `evt_${timestamp}_1`,
      tenant_id: TENANT_ID,
      timestamp: timestamp,
      source_type: 'application',
      event: {
        category: 'authentication',
        type: 'authentication',
        action: 'login',
        outcome: 'success'
      },
      user: {
        id: userId,
        name: 'lowpriv_user'
      },
      host: {
        id: hostId,
        hostname: 'web-server-01',
        ip: '10.0.1.100'
      }
    },
    // 2. Suspicious process spawn
    {
      event_id: `evt_${timestamp}_2`,
      tenant_id: TENANT_ID,
      timestamp: timestamp + 1000000, // 1 second later
      source_type: 'application',
      event: {
        category: 'process',
        type: 'process_start',
        action: 'spawned',
        outcome: 'success'
      },
      process: {
        id: processId,
        pid: Math.floor(Math.random() * 65535),
        name: 'sudo',
        command_line: 'sudo su -',
        parent_id: 'proc_parent'
      },
      user: {
        id: userId,
        name: 'lowpriv_user'
      },
      host: {
        id: hostId,
        hostname: 'web-server-01'
      }
    },
    // 3. Privilege escalation
    {
      event_id: `evt_${timestamp}_3`,
      tenant_id: TENANT_ID,
      timestamp: timestamp + 2000000, // 2 seconds later
      source_type: 'application',
      event: {
        category: 'authentication',
        type: 'authentication',
        action: 'privilege_escalation',
        outcome: 'success'
      },
      user: {
        id: userId,
        name: 'root'
      },
      process: {
        id: processId,
        name: 'sudo'
      },
      host: {
        id: hostId,
        hostname: 'web-server-01'
      }
    },
    // 4. Suspicious file access
    {
      event_id: `evt_${timestamp}_4`,
      tenant_id: TENANT_ID,
      timestamp: timestamp + 3000000, // 3 seconds later
      source_type: 'application',
      event: {
        category: 'file',
        type: 'file_access',
        action: 'read',
        outcome: 'success'
      },
      file: {
        path: '/etc/shadow',
        hash: `sha256_${randomString(64)}`
      },
      user: {
        id: userId,
        name: 'root'
      },
      process: {
        id: processId,
        name: 'cat'
      },
      host: {
        id: hostId,
        hostname: 'web-server-01'
      }
    }
  ];
}

export default function() {
  const attackEvents = generateAttackPattern();
  const startTime = Date.now();
  
  // Ingest attack pattern events
  const payload = JSON.stringify({ events: attackEvents });
  
  const ingestResponse = http.post(
    `${BASE_URL}/api/telemetry/ingest`,
    payload,
    { headers: { 'Content-Type': 'application/json' } }
  );
  
  check(ingestResponse, {
    'ingestion successful': (r) => r.status === 200 || r.status === 202,
  });
  
  eventsIngested.add(attackEvents.length);
  
  // Poll for incident creation (detection)
  let incidentDetected = false;
  let attempts = 0;
  const maxAttempts = 20; // 20 seconds max
  
  while (!incidentDetected && attempts < maxAttempts) {
    sleep(1);
    attempts++;
    
    // Check for new incidents
    const incidentsResponse = http.get(
      `${BASE_URL}/api/incidents?limit=10`,
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    if (incidentsResponse.status === 200) {
      try {
        const incidents = JSON.parse(incidentsResponse.body);
        
        // Check if any incident was created in the last 30 seconds
        const recentIncidents = incidents.filter(inc => {
          const createdAt = new Date(inc.created_at).getTime();
          return (Date.now() - createdAt) < 30000;
        });
        
        if (recentIncidents.length > 0) {
          incidentDetected = true;
          const detectionTime = Date.now() - startTime;
          detectionLatency.add(detectionTime);
          incidentsCreated.add(1);
          
          console.log(`Incident detected in ${detectionTime}ms`);
        }
      } catch (e) {
        console.error('Failed to parse incidents response:', e);
      }
    }
  }
  
  if (!incidentDetected) {
    console.warn('No incident detected within timeout');
  }
  
  sleep(5); // Wait before next attack pattern
}

export function setup() {
  console.log('Starting detection latency test');
  console.log('Generating attack patterns and measuring detection time');
}

export function teardown(data) {
  console.log('Detection latency test completed');
}

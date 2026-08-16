import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const apiSuccessRate = new Rate('api_success_rate');
const apiLatency = new Trend('api_latency');

// Test configuration
export const options = {
  stages: [
    { duration: '1m', target: 50 },    // Ramp up
    { duration: '3m', target: 50 },    // Stay at 50 concurrent users
    { duration: '1m', target: 100 },   // Ramp up
    { duration: '3m', target: 100 },   // Stay at 100 concurrent users
    { duration: '1m', target: 200 },   // Ramp up
    { duration: '3m', target: 200 },   // Stay at 200 concurrent users
    { duration: '1m', target: 0 },     // Ramp down
  ],
  thresholds: {
    'api_success_rate': ['rate>0.99'],
    'api_latency': ['p(95)<200'],      // 95% under 200ms
    'http_req_duration': ['p(95)<200'],
    'http_req_failed': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
let authToken = '';
let tenantId = '';

// Setup - authenticate once
export function setup() {
  // Login to get auth token
  const loginPayload = JSON.stringify({
    username: __ENV.TEST_USER || 'test@example.com',
    password: __ENV.TEST_PASSWORD || 'testpassword123'
  });
  
  const loginResponse = http.post(
    `${BASE_URL}/api/auth/login`,
    loginPayload,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  
  if (loginResponse.status === 200) {
    const data = JSON.parse(loginResponse.body);
    authToken = data.access_token;
    tenantId = data.tenant_id;
    console.log('Authentication successful');
  } else {
    console.error('Authentication failed:', loginResponse.status);
  }
  
  return { authToken, tenantId };
}

// Main test function
export default function(data) {
  const headers = {
    'Authorization': `Bearer ${data.authToken}`,
    'Content-Type': 'application/json',
  };
  
  // Test 1: List deployments
  group('List Deployments', () => {
    const response = http.get(
      `${BASE_URL}/api/deployments?limit=20`,
      { headers }
    );
    
    const success = check(response, {
      'status is 200': (r) => r.status === 200,
      'response time < 200ms': (r) => r.timings.duration < 200,
      'has deployments array': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body);
        } catch {
          return false;
        }
      }
    });
    
    apiSuccessRate.add(success);
    apiLatency.add(response.timings.duration);
  });
  
  sleep(0.5);
  
  // Test 2: List incidents
  group('List Incidents', () => {
    const response = http.get(
      `${BASE_URL}/api/incidents?limit=20`,
      { headers }
    );
    
    const success = check(response, {
      'status is 200': (r) => r.status === 200,
      'response time < 200ms': (r) => r.timings.duration < 200,
      'has incidents array': (r) => {
        try {
          const body = JSON.parse(r.body);
          return Array.isArray(body);
        } catch {
          return false;
        }
      }
    });
    
    apiSuccessRate.add(success);
    apiLatency.add(response.timings.duration);
  });
  
  sleep(0.5);
  
  // Test 3: Get tenant info
  group('Get Tenant', () => {
    const response = http.get(
      `${BASE_URL}/api/tenants/${data.tenantId}`,
      { headers }
    );
    
    const success = check(response, {
      'status is 200': (r) => r.status === 200,
      'response time < 100ms': (r) => r.timings.duration < 100,
      'has tenant data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.tenant_id === data.tenantId;
        } catch {
          return false;
        }
      }
    });
    
    apiSuccessRate.add(success);
    apiLatency.add(response.timings.duration);
  });
  
  sleep(0.5);
  
  // Test 4: Get current user
  group('Get Current User', () => {
    const response = http.get(
      `${BASE_URL}/api/auth/me`,
      { headers }
    );
    
    const success = check(response, {
      'status is 200': (r) => r.status === 200,
      'response time < 100ms': (r) => r.timings.duration < 100,
      'has user data': (r) => {
        try {
          const body = JSON.parse(r.body);
          return body.email !== undefined;
        } catch {
          return false;
        }
      }
    });
    
    apiSuccessRate.add(success);
    apiLatency.add(response.timings.duration);
  });
  
  sleep(1);
}

export function teardown(data) {
  console.log('API performance test completed');
}

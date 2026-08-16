# KAYO Load Testing Suite

## Overview

This directory contains load testing scripts for validating KAYO platform performance under production-scale load.

## Tools

- **k6**: Primary load testing tool (https://k6.io/)
- **Python scripts**: Data generation and analysis
- **Prometheus**: Metrics collection during tests

## Test Scenarios

1. **Telemetry Ingestion**: Test event ingestion at 100K events/sec
2. **Detection Engine**: Measure detection latency under load
3. **API Performance**: Test API response times with concurrent users
4. **Graph Queries**: Validate graph query performance
5. **End-to-End**: Complete workflow from ingestion to incident

## Prerequisites

```bash
# Install k6
brew install k6  # macOS
# or
sudo apt-get install k6  # Ubuntu

# Install Python dependencies
pip install -r requirements.txt
```

## Running Tests

```bash
# Run all tests
make load-test-all

# Run specific test
k6 run tests/load/telemetry-ingestion.js

# Run with custom parameters
k6 run --vus 100 --duration 5m tests/load/api-performance.js
```

## Performance Targets

| Metric | Target | Measured | Status |
|--------|--------|----------|--------|
| Telemetry Ingestion | 100K events/sec | TBD | ⏳ |
| Detection Latency (p95) | <5s | TBD | ⏳ |
| API Response Time (p95) | <200ms | TBD | ⏳ |
| Graph Query (p95) | <1s | TBD | ⏳ |
| Memory Usage | <80% | TBD | ⏳ |
| CPU Usage | <70% | TBD | ⏳ |

## Test Results

Results are stored in `tests/load/results/` with timestamps.

## Interpreting Results

- **p50**: Median response time
- **p95**: 95th percentile (acceptable for most users)
- **p99**: 99th percentile (worst case for most users)
- **Throughput**: Requests per second
- **Error Rate**: Percentage of failed requests

## Troubleshooting

### High Latency
- Check Kafka consumer lag
- Verify database connection pool size
- Check for slow queries in logs

### High Error Rate
- Check service logs for exceptions
- Verify resource limits not exceeded
- Check network connectivity

### Resource Exhaustion
- Scale up infrastructure
- Optimize queries
- Implement caching

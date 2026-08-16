#!/bin/bash
set -e

echo "🧪 Running KAYO test suite..."

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Run unit tests
echo "📝 Running unit tests..."
if pytest tests/unit/ -v --cov --cov-report=term-missing; then
    echo -e "${GREEN}✅ Unit tests passed${NC}"
else
    echo -e "${RED}❌ Unit tests failed${NC}"
    exit 1
fi

# Run integration tests
echo "📝 Running integration tests..."
if pytest tests/integration/ -v; then
    echo -e "${GREEN}✅ Integration tests passed${NC}"
else
    echo -e "${RED}❌ Integration tests failed${NC}"
    exit 1
fi

# Run load tests (if k6 is installed)
if command -v k6 >/dev/null 2>&1; then
    echo "📝 Running load tests..."
    cd tests/load
    k6 run --quiet telemetry-ingestion.js
    k6 run --quiet api-performance.js
    k6 run --quiet detection-latency.js
    cd ../..
    echo -e "${GREEN}✅ Load tests passed${NC}"
else
    echo "⚠️  k6 not installed, skipping load tests"
fi

# Run security tests
echo "📝 Running security tests..."
if python tests/security/owasp_tests.py --target http://localhost:8000; then
    echo -e "${GREEN}✅ Security tests passed${NC}"
else
    echo -e "${RED}❌ Security tests failed${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All tests passed!${NC}"

#!/usr/bin/env python3
"""
Performance monitoring script for KAYO load tests.

Collects metrics from:
- Prometheus (service metrics)
- Kafka (consumer lag)
- ClickHouse (query performance)
- Neo4j (graph query performance)
- System resources (CPU, memory)

Usage:
    python monitor_performance.py --duration 3600 --output results/metrics.json
"""

import argparse
import json
import time
import requests
from datetime import datetime, timedelta
from typing import Dict, List, Any
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__
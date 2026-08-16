"""
Basic ML anomaly detection using statistical baseline modeling.
MITRE ATT&CK: Supports detection across multiple tactics via behavioral baselines.
"""
import logging
import statistics
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Rolling window size for baseline (number of time buckets)
WINDOW_SIZE = 60  # 60 x 1-minute buckets = 1 hour baseline
ANOMALY_THRESHOLD = 2.5  # standard deviations


class TenantBaseline:
    """Maintains rolling event frequency baseline per tenant."""

    def __init__(self, window_size: int = WINDOW_SIZE):
        self.window_size = window_size
        # Deque of (timestamp_bucket, count) pairs
        self.event_counts: deque = deque(maxlen=window_size)
        self.process_counts: deque = deque(maxlen=window_size)
        self.network_counts: deque = deque(maxlen=window_size)

    def _current_bucket(self) -> str:
        """Return current 1-minute time bucket key."""
        now = datetime.utcnow()
        return now.strftime("%Y-%m-%dT%H:%M")

    def record_event(self, event_type: str):
        """Record an incoming event into the current time bucket."""
        bucket = self._current_bucket()
        target = self.event_counts

        if event_type == "process":
            target = self.process_counts
        elif event_type == "network":
            target = self.network_counts

        # Update or append current bucket
        if target and target[-1][0] == bucket:
            last = target[-1]
            target[-1] = (last[0], last[1] + 1)
        else:
            target.append((bucket, 1))

    def _stats(self, counts: deque) -> Tuple[float, float]:
        """Return (mean, stdev) of counts, ignoring current bucket."""
        values = [c for _, c in list(counts)[:-1]]  # exclude current
        if len(values) < 5:
            return 0.0, 0.0
        mean = statistics.mean(values)
        stdev = statistics.stdev(values) if len(values) > 1 else 0.0
        return mean, stdev

    def is_anomalous(self, event_type: str, current_count: int) -> Optional[Dict]:
        """
        Check if current_count is anomalous vs baseline.
        Returns anomaly dict if anomalous, None otherwise.
        """
        target = self.event_counts
        if event_type == "process":
            target = self.process_counts
        elif event_type == "network":
            target = self.network_counts

        mean, stdev = self._stats(target)
        if stdev == 0:
            return None

        z_score = (current_count - mean) / stdev
        if z_score > ANOMALY_THRESHOLD:
            return {
                "event_type": event_type,
                "current_count": current_count,
                "baseline_mean": round(mean, 2),
                "baseline_stdev": round(stdev, 2),
                "z_score": round(z_score, 2),
                "severity": "high" if z_score > 4.0 else "medium",
            }
        return None


class AnomalyDetector:
    """
    Detects behavioral anomalies by comparing current event rates
    against per-tenant rolling baselines.

    Algorithm:
    - Maintains 1-hour rolling baseline per tenant (60 x 1-min buckets)
    - Flags events where z-score > 2.5 standard deviations from mean
    - Separate baselines for: total events, process events, network events

    Time complexity: O(1) per event recording, O(w) per anomaly check (w = window size)
    """

    def __init__(self):
        self._baselines: Dict[str, TenantBaseline] = defaultdict(TenantBaseline)

    def record(self, tenant_id: str, event_type: str):
        """Record an event for a tenant."""
        self._baselines[tenant_id].record_event(event_type)
        self._baselines[tenant_id].record_event("total")

    def check(self, tenant_id: str, event_type: str, current_count: int) -> Optional[Dict]:
        """
        Check if current event count is anomalous for this tenant.

        Args:
            tenant_id: Tenant identifier
            event_type: 'process', 'network', or 'total'
            current_count: Number of events in current time bucket

        Returns:
            Anomaly dict with severity and z-score, or None if normal
        """
        baseline = self._baselines.get(tenant_id)
        if not baseline:
            return None
        result = baseline.is_anomalous(event_type, current_count)
        if result:
            result["tenant_id"] = tenant_id
            logger.warning(
                f"Anomaly detected for tenant {tenant_id}: "
                f"{event_type} count={current_count} "
                f"(mean={result['baseline_mean']}, z={result['z_score']})"
            )
        return result

    def get_current_counts(self, tenant_id: str) -> Dict[str, int]:
        """Get current bucket counts for a tenant."""
        baseline = self._baselines.get(tenant_id)
        if not baseline:
            return {}
        result = {}
        for name, deq in [
            ("total", baseline.event_counts),
            ("process", baseline.process_counts),
            ("network", baseline.network_counts),
        ]:
            if deq:
                result[name] = deq[-1][1]
        return result


# Singleton instance shared across the detection engine
anomaly_detector = AnomalyDetector()

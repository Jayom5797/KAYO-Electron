"""
KAYO Resilience/Stress Tester

Extracted from: SEVE-SaaS/kayo_stress.py
Purpose: Controlled load testing to evaluate application resilience under stress.

Changes from original:
- Converted from CLI script to importable module with structured output
- Added authorization check requirement
- Added configurable limits (max concurrency, max duration)
- Made results strongly typed
- Added safety timeout enforcement

IMPORTANT: Stress testing must ONLY be performed against targets the user
owns or has explicit authorization to test. The service layer must enforce
this authorization before calling these functions.
"""
import time
import threading
import statistics
import socket
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from urllib.request import urlopen, Request
from urllib.error import HTTPError

logger = logging.getLogger(__name__)

# Safety limits
MAX_CONCURRENCY = 50
MAX_DURATION_S = 120
MAX_TIMEOUT_S = 10


@dataclass
class StressResult:
    """Complete stress test result"""
    url: str
    duration_s: int
    actual_duration_s: float
    concurrency: int
    total_requests: int
    rps_avg: float
    success_rate_pct: float
    error_count: int
    latency_min_ms: int = 0
    latency_max_ms: int = 0
    latency_avg_ms: float = 0
    latency_p95_ms: float = 0
    latency_p99_ms: float = 0
    breaking_point: Optional[Dict[str, Any]] = None
    verdict: str = "UNKNOWN"  # RESILIENT, DEGRADED, VULNERABLE


def run_stress_test(
    url: str,
    concurrency: int = 20,
    duration: int = 30,
    timeout: int = 5,
) -> StressResult:
    """
    Run a controlled stress test against a URL.

    Args:
        url: Target URL (must be authorized)
        concurrency: Number of concurrent workers (capped at MAX_CONCURRENCY)
        duration: Test duration in seconds (capped at MAX_DURATION_S)
        timeout: Per-request timeout (capped at MAX_TIMEOUT_S)

    Returns:
        StressResult with comprehensive metrics
    """
    # Enforce safety limits
    concurrency = min(concurrency, MAX_CONCURRENCY)
    duration = min(duration, MAX_DURATION_S)
    timeout = min(timeout, MAX_TIMEOUT_S)

    if not url.startswith("http"):
        url = "https://" + url

    # Verify target is reachable before starting
    try:
        socket.setdefaulttimeout(10)
        req = Request(url, headers={"User-Agent": "KAYO-StressTest/1.0"})
        with urlopen(req, timeout=10) as resp:
            baseline_status = resp.status
            resp.read()
    except HTTPError as e:
        baseline_status = e.code
    except Exception as e:
        return StressResult(
            url=url, duration_s=duration, actual_duration_s=0,
            concurrency=concurrency, total_requests=0,
            rps_avg=0, success_rate_pct=0, error_count=0,
            verdict="UNREACHABLE",
        )

    results: List[Dict[str, Any]] = []
    stop_event = threading.Event()
    start_time = time.time()
    deadline = start_time + duration + timeout + 2

    def worker():
        while not stop_event.is_set() and time.time() < deadline:
            start = time.time()
            status = 0
            try:
                old = socket.getdefaulttimeout()
                socket.setdefaulttimeout(timeout)
                req = Request(url, headers={"User-Agent": "KAYO-StressTest/1.0"})
                with urlopen(req, timeout=timeout) as resp:
                    status = resp.status
                    resp.read()
                socket.setdefaulttimeout(old)
            except HTTPError as e:
                status = e.code
            except Exception:
                status = 0
            latency = round((time.time() - start) * 1000)
            if latency > 0:
                results.append({"status": status, "latency_ms": latency, "ts": time.time()})

    # Start workers
    threads = [
        threading.Thread(target=worker, daemon=True)
        for _ in range(concurrency)
    ]
    for t in threads:
        t.start()

    # Wait for duration
    while time.time() - start_time < duration:
        time.sleep(1)

    stop_event.set()
    time.sleep(2)  # Grace period for workers to finish

    actual_duration = round(time.time() - start_time, 1)
    total = len(results)

    if total == 0:
        return StressResult(
            url=url, duration_s=duration, actual_duration_s=actual_duration,
            concurrency=concurrency, total_requests=0,
            rps_avg=0, success_rate_pct=0, error_count=0,
            verdict="UNREACHABLE",
        )

    latencies = [r["latency_ms"] for r in results if r["latency_ms"] > 0]
    errors = sum(1 for r in results if r["status"] == 0 or r["status"] >= 500)
    success_rate = round((total - errors) / total * 100, 1)

    # Find breaking point
    breaking_point = None
    window = 20
    for i in range(window, len(results), window):
        chunk = results[i - window:i]
        chunk_errors = sum(1 for r in chunk if r["status"] == 0 or r["status"] >= 500)
        if chunk_errors / window > 0.1:
            elapsed_at_break = chunk[0]["ts"] - start_time
            breaking_point = {
                "at_second": round(elapsed_at_break, 1),
                "error_rate_pct": round(chunk_errors / window * 100, 1),
            }
            break

    sorted_lat = sorted(latencies) if latencies else [0]

    verdict = (
        "RESILIENT" if success_rate >= 99 else
        "DEGRADED" if success_rate >= 90 else
        "VULNERABLE"
    )

    return StressResult(
        url=url,
        duration_s=duration,
        actual_duration_s=actual_duration,
        concurrency=concurrency,
        total_requests=total,
        rps_avg=round(total / actual_duration, 1) if actual_duration > 0 else 0,
        success_rate_pct=success_rate,
        error_count=errors,
        latency_min_ms=min(latencies) if latencies else 0,
        latency_max_ms=max(latencies) if latencies else 0,
        latency_avg_ms=round(statistics.mean(latencies), 1) if latencies else 0,
        latency_p95_ms=round(sorted_lat[int(len(sorted_lat) * 0.95)], 1) if latencies else 0,
        latency_p99_ms=round(sorted_lat[int(len(sorted_lat) * 0.99)], 1) if latencies else 0,
        breaking_point=breaking_point,
        verdict=verdict,
    )

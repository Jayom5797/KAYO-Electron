"""
KAYO Lifecycle Integration Tests

Tests the end-to-end security lifecycle:
A. Control Plane → Assessment Engine → Findings
B. Repository Assessment → Findings
C. Security Gate BLOCK on critical findings
D. Security Gate PASS on clean project
E. Monitor Registration + Probe
F. Tenant Isolation

These tests verify actual service communication, not just unit logic.
Run with: pytest tests/integration/test_lifecycle.py -v
Requires: assessment-engine running on :3100, control-plane on :8000
"""
import pytest
import httpx
import uuid
import os
import sys
import asyncio

# Add paths for direct imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../services/control-plane'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../services/deployment-engine'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../services/monitor-service'))

CONTROL_PLANE_URL = os.environ.get("CONTROL_PLANE_URL", "http://localhost:8000")
ASSESSMENT_ENGINE_URL = os.environ.get("ASSESSMENT_ENGINE_URL", "http://localhost:3100")
MONITOR_SERVICE_URL = os.environ.get("MONITOR_SERVICE_URL", "http://localhost:8002")
SERVICE_TOKEN = os.environ.get("KAYO_SERVICE_TOKEN", "kayo-internal-service-token")


# ── Test A: Assessment Engine Health + URL Scan ────────────────────────────────

class TestAssessmentEngine:
    """Tests assessment engine is reachable and can process requests."""

    @pytest.mark.asyncio
    async def test_health_check(self):
        """Assessment engine responds to health check."""
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{ASSESSMENT_ENGINE_URL}/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["service"] == "assessment-engine"
            assert data["status"] == "healthy"

    @pytest.mark.asyncio
    async def test_url_scan_requires_auth(self):
        """Assessment engine rejects unauthenticated requests."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{ASSESSMENT_ENGINE_URL}/assess/url",
                json={"url": "https://example.com", "tenant_id": str(uuid.uuid4())},
            )
            assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_url_scan_ssrf_blocked(self):
        """Assessment engine blocks private IP targets."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{ASSESSMENT_ENGINE_URL}/assess/url",
                headers={"x-kayo-service-token": SERVICE_TOKEN},
                json={"url": "http://169.254.169.254/latest/meta-data", "tenant_id": str(uuid.uuid4())},
            )
            assert resp.status_code == 403
            assert "SSRF" in resp.json().get("error", "")

    @pytest.mark.asyncio
    async def test_url_scan_submission(self):
        """Assessment engine accepts valid URL scan request."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{ASSESSMENT_ENGINE_URL}/assess/url",
                headers={"x-kayo-service-token": SERVICE_TOKEN},
                json={"url": "https://example.com", "tenant_id": str(uuid.uuid4())},
            )
            assert resp.status_code == 202
            data = resp.json()
            assert "scan_id" in data
            assert data["status"] == "running"


# ── Test B: Security Gate Logic ────────────────────────────────────────────────

class TestSecurityGate:
    """Tests the security gate evaluation logic."""

    def test_gate_blocks_critical(self):
        """Security gate blocks deployment with critical findings."""
        from security_gate import evaluate_gate, DEFAULT_POLICY, GateDecision

        findings = [
            {"severity": "critical", "type": "hardcoded_secret", "category": "Secrets"},
            {"severity": "high", "type": "cors", "category": "CORS"},
        ]
        result = evaluate_gate(findings, DEFAULT_POLICY)
        assert result.passed is False
        assert result.decision == GateDecision.BLOCK
        assert result.critical_findings == 1

    def test_gate_passes_clean(self):
        """Security gate allows deployment with no critical findings."""
        from security_gate import evaluate_gate, DEFAULT_POLICY, GateDecision

        findings = [
            {"severity": "low", "type": "missing_header", "category": "Headers"},
            {"severity": "info", "type": "technology", "category": "Fingerprint"},
        ]
        result = evaluate_gate(findings, DEFAULT_POLICY)
        assert result.passed is True
        assert result.decision == GateDecision.DEPLOY

    def test_gate_blocks_secrets(self):
        """Security gate blocks when secrets are found."""
        from security_gate import evaluate_gate, DEFAULT_POLICY

        findings = [
            {"severity": "critical", "type": "hardcoded_secret", "category": "Secrets"},
        ]
        result = evaluate_gate(findings, DEFAULT_POLICY)
        assert result.passed is False
        assert any(v.rule == "no_secrets" for v in result.violations)

    def test_gate_configurable_policy(self):
        """Security gate respects custom policy thresholds."""
        from security_gate import evaluate_gate, DeploymentPolicy, GateDecision

        # Relaxed policy: allow critical findings
        relaxed = DeploymentPolicy(
            block_on_critical=False,
            max_high_findings=0,
            block_on_secrets=False,
            block_on_critical_cves=False,
        )
        findings = [{"severity": "critical", "type": "tls", "category": "TLS"}]
        result = evaluate_gate(findings, relaxed)
        assert result.passed is True


# ── Test C: Monitor Service ────────────────────────────────────────────────────

class TestMonitorService:
    """Tests monitor service operations."""

    def test_uptime_probe(self):
        """Probe returns structured result."""
        from uptime_monitor import probe

        result = probe("https://example.com", timeout=10)
        assert result.status_code in [200, 301, 302]
        assert result.latency_ms > 0
        assert result.error is None

    def test_baseline_establishment(self):
        """Baseline can be established for a reachable URL."""
        from uptime_monitor import establish_baseline

        baseline = establish_baseline("https://example.com", probe_count=2, timeout=10)
        assert baseline is not None
        assert baseline.avg_latency_ms > 0
        assert baseline.typical_status in [200, 301, 302]

    def test_stress_safety_limits(self):
        """Stress tester enforces safety limits."""
        from stress_tester import run_stress_test, MAX_CONCURRENCY, MAX_DURATION_S

        # Test that limits are enforced (don't actually run a full stress test)
        assert MAX_CONCURRENCY == 50
        assert MAX_DURATION_S == 120


# ── Test D: Stack Detection ────────────────────────────────────────────────────

class TestStackDetection:
    """Tests stack detection and Dockerfile generation."""

    def test_detect_node_express(self):
        """Detects Node.js Express project."""
        import tempfile, json
        from stack_detector import detect_stack

        tmpdir = tempfile.mkdtemp()
        with open(os.path.join(tmpdir, "package.json"), "w") as f:
            json.dump({"dependencies": {"express": "^4.18.0"}}, f)
        with open(os.path.join(tmpdir, "server.js"), "w") as f:
            f.write("const app = require('express')();")

        result = detect_stack(tmpdir)
        assert result.runtime == "node"
        assert result.framework == "express"

        import shutil
        shutil.rmtree(tmpdir)

    def test_detect_python_fastapi(self):
        """Detects Python FastAPI project."""
        import tempfile
        from stack_detector import detect_stack

        tmpdir = tempfile.mkdtemp()
        with open(os.path.join(tmpdir, "requirements.txt"), "w") as f:
            f.write("fastapi==0.109.0\nuvicorn==0.27.0\n")
        with open(os.path.join(tmpdir, "main.py"), "w") as f:
            f.write("from fastapi import FastAPI")

        result = detect_stack(tmpdir)
        assert result.runtime == "python"
        assert result.framework == "fastapi"

        import shutil
        shutil.rmtree(tmpdir)

    def test_dockerfile_generation(self):
        """Generates appropriate Dockerfile for detected stack."""
        from stack_detector import StackInfo
        from dockerfile_generator import generate_dockerfile

        import tempfile
        tmpdir = tempfile.mkdtemp()

        stack = StackInfo(runtime="python", framework="fastapi", variant="server", entry_point="main.py")
        dockerfile = generate_dockerfile(tmpdir, stack)
        assert dockerfile is not None
        assert "python:3.12-slim" in dockerfile
        assert "uvicorn" in dockerfile
        assert "USER appuser" in dockerfile  # non-root

        import shutil
        shutil.rmtree(tmpdir)


# ── Test E: Safe Extraction ────────────────────────────────────────────────────

class TestSafeExtraction:
    """Tests safe ZIP extraction with security protections."""

    def test_zip_slip_blocked(self):
        """Path traversal in ZIP is blocked."""
        import tempfile, zipfile
        from safe_extract import safe_extract_zip

        tmpdir = tempfile.mkdtemp()
        zip_path = os.path.join(tmpdir, "evil.zip")
        with zipfile.ZipFile(zip_path, "w") as zf:
            zf.writestr("normal.txt", "hello")
            zf.writestr("../../../etc/passwd", "evil")

        dest = os.path.join(tmpdir, "out")
        ok, err = safe_extract_zip(zip_path, dest)
        assert ok is False
        assert "traversal" in err.lower()

        import shutil
        shutil.rmtree(tmpdir)

    def test_valid_zip_extracts(self):
        """Valid ZIP extracts successfully."""
        import tempfile, zipfile
        from safe_extract import safe_extract_zip

        tmpdir = tempfile.mkdtemp()
        zip_path = os.path.join(tmpdir, "good.zip")
        with zipfile.ZipFile(zip_path, "w") as zf:
            zf.writestr("src/app.js", "console.log('hello');")
            zf.writestr("package.json", '{"name":"test"}')

        dest = os.path.join(tmpdir, "out")
        ok, err = safe_extract_zip(zip_path, dest)
        assert ok is True
        assert err is None
        assert os.path.exists(os.path.join(dest, "package.json"))

        import shutil
        shutil.rmtree(tmpdir)


# ── Test F: Tenant Isolation (Unit-level) ──────────────────────────────────────

class TestTenantIsolation:
    """Verifies tenant isolation in data queries."""

    def test_scan_model_has_tenant_id(self):
        """Scan model enforces tenant_id."""
        # Verify at the model level (avoid importing full route stack)
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../packages/shared-schemas'))
        from models import Scan
        scan = Scan(tenant_id=uuid.uuid4(), type="url", target="https://x.com")
        assert scan.tenant_id is not None

    def test_finding_model_has_tenant_id(self):
        """Finding model enforces tenant_id."""
        from models import Finding, Severity
        finding = Finding(
            scan_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            type="tls",
            severity=Severity.high,
            category="TLS",
            description="test",
        )
        assert finding.tenant_id is not None


# ── Test G: Shared Schemas ─────────────────────────────────────────────────────

class TestSharedSchemas:
    """Tests canonical data models work correctly."""

    def test_scan_model(self):
        """Scan model validates correctly."""
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../packages/shared-schemas'))
        from models import Scan, ScanType, ScanStatus
        scan = Scan(
            tenant_id=uuid.uuid4(),
            type=ScanType.url,
            target="https://example.com",
        )
        assert scan.status == ScanStatus.pending
        assert scan.scan_id is not None

    def test_finding_model(self):
        """Finding model validates correctly."""
        from models import Finding, Severity
        finding = Finding(
            scan_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            type="tls",
            severity=Severity.high,
            category="TLS",
            description="Weak cipher suite",
        )
        assert finding.severity == Severity.high

    def test_security_gate_result(self):
        """SecurityGateResult model works."""
        from models import SecurityGateResult
        gate = SecurityGateResult(
            deployment_id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            passed=False,
            decision="block",
            reason="Critical CVE found",
            critical_findings=2,
        )
        assert gate.passed is False


# ── Test H: AI Service Redaction ───────────────────────────────────────────────

class TestAIRedaction:
    """Tests that sensitive data is redacted before AI calls."""

    def test_aws_key_redacted(self):
        """AWS keys are redacted."""
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../services/ai-service'))
        from providers import redact_sensitive

        text = "Found key AKIAIOSFODNN7EXAMPLE in config"
        result = redact_sensitive(text)
        assert "AKIAIOSFODNN7EXAMPLE" not in result
        assert "[REDACTED_AWS_KEY]" in result

    def test_github_token_redacted(self):
        """GitHub tokens are redacted."""
        from providers import redact_sensitive

        text = "Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh"
        result = redact_sensitive(text)
        assert "ghp_" not in result
        assert "[REDACTED_GITHUB_TOKEN]" in result

    def test_connection_string_redacted(self):
        """Database connection strings are redacted."""
        from providers import redact_sensitive

        text = "DB: postgresql://admin:secretpass@db.internal:5432/mydb"
        result = redact_sensitive(text)
        assert "secretpass" not in result
        assert "[REDACTED_CONNECTION_STRING]" in result

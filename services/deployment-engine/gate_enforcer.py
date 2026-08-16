"""
Security Gate Enforcer

This module enforces the security gate as a MANDATORY step before any deployment.
It is called by the deployment orchestrator before build/deploy can proceed.

Flow:
  1. Receive deployment request
  2. Trigger repository assessment via assessment engine
  3. Wait for assessment completion
  4. Evaluate security gate against findings
  5. Return PASS/BLOCK decision
  6. Deployment orchestrator MUST respect this decision

No deployment can bypass this module.
"""
import httpx
import logging
import time
from typing import Dict, Any, Optional, Tuple
from security_gate import evaluate_gate, DeploymentPolicy, GateResult, GateDecision

logger = logging.getLogger(__name__)


class GateEnforcer:
    """
    Enforces security gate as a mandatory deployment prerequisite.
    
    The deployment orchestrator must call enforce() before proceeding.
    If the result is BLOCK, the orchestrator MUST NOT deploy.
    """

    def __init__(
        self,
        assessment_engine_url: str = "http://localhost:3100",
        service_token: str = "dev-token",
        policy: Optional[DeploymentPolicy] = None,
    ):
        self.assessment_url = assessment_engine_url
        self.service_token = service_token
        self.policy = policy or DeploymentPolicy()
        self.headers = {
            "x-kayo-service-token": self.service_token,
            "Content-Type": "application/json",
        }

    def enforce(
        self,
        git_repo: str,
        tenant_id: str,
        deployment_id: str,
        timeout_s: int = 300,
    ) -> Tuple[GateResult, Optional[str]]:
        """
        Enforce the security gate for a deployment.

        This is a BLOCKING call that:
        1. Triggers repository assessment
        2. Waits for completion
        3. Evaluates findings against policy
        4. Returns gate decision

        Args:
            git_repo: Repository URL to assess
            tenant_id: Tenant UUID
            deployment_id: Deployment UUID (for tracking)
            timeout_s: Maximum time to wait for assessment

        Returns:
            Tuple of (GateResult, scan_id or None)
            
        The caller MUST check result.passed before proceeding with deployment.
        """
        logger.info(f"Security gate enforcement started for deployment {deployment_id}")

        # Step 1: Trigger repository assessment
        scan_id = self._trigger_assessment(git_repo, tenant_id)
        if not scan_id:
            # If assessment engine is unavailable, BLOCK deployment (fail-closed)
            logger.error("Assessment engine unavailable — blocking deployment (fail-closed)")
            return GateResult(
                passed=False,
                decision=GateDecision.BLOCK,
                reason="Assessment engine unavailable — cannot verify security posture",
                violations=[],
                critical_findings=0,
                high_findings=0,
                medium_findings=0,
                low_findings=0,
                scans_evaluated=0,
            ), None

        # Step 2: Wait for assessment to complete
        logger.info(f"Waiting for assessment {scan_id} to complete...")
        status = self._wait_for_completion(scan_id, timeout_s)

        if status != "completed":
            logger.error(f"Assessment did not complete (status: {status}) — blocking deployment")
            return GateResult(
                passed=False,
                decision=GateDecision.BLOCK,
                reason=f"Assessment did not complete (status: {status})",
                violations=[],
                critical_findings=0,
                high_findings=0,
                medium_findings=0,
                low_findings=0,
                scans_evaluated=0,
            ), scan_id

        # Step 3: Get findings
        findings = self._get_findings(scan_id)
        if findings is None:
            logger.error("Could not retrieve findings — blocking deployment")
            return GateResult(
                passed=False,
                decision=GateDecision.BLOCK,
                reason="Could not retrieve assessment findings",
                violations=[],
                critical_findings=0,
                high_findings=0,
                medium_findings=0,
                low_findings=0,
                scans_evaluated=0,
            ), scan_id

        # Step 4: Evaluate gate
        result = evaluate_gate(findings, self.policy)
        
        logger.info(
            f"Security gate decision for deployment {deployment_id}: "
            f"{result.decision.value} ({result.critical_findings} critical, "
            f"{result.high_findings} high findings)"
        )

        return result, scan_id

    def _trigger_assessment(self, git_repo: str, tenant_id: str) -> Optional[str]:
        """Trigger repository assessment and return scan_id."""
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(
                    f"{self.assessment_url}/assess/repository",
                    headers=self.headers,
                    json={"url": git_repo, "tenant_id": tenant_id},
                )
                if resp.status_code == 202:
                    return resp.json().get("scan_id")
                logger.error(f"Assessment trigger failed: {resp.status_code} {resp.text}")
                return None
        except Exception as e:
            logger.error(f"Assessment trigger error: {e}")
            return None

    def _wait_for_completion(self, scan_id: str, timeout_s: int) -> str:
        """Poll assessment status until complete or timeout."""
        deadline = time.time() + timeout_s
        poll_interval = 2.0

        while time.time() < deadline:
            try:
                with httpx.Client(timeout=10.0) as client:
                    resp = client.get(
                        f"{self.assessment_url}/assess/{scan_id}",
                        headers=self.headers,
                    )
                    if resp.status_code == 200:
                        status = resp.json().get("status", "unknown")
                        if status in ("completed", "failed"):
                            return status
            except Exception as e:
                logger.warning(f"Poll error: {e}")

            time.sleep(poll_interval)

        return "timeout"

    def _get_findings(self, scan_id: str) -> Optional[list]:
        """Retrieve findings from assessment engine."""
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(
                    f"{self.assessment_url}/assess/{scan_id}/findings",
                    headers=self.headers,
                )
                if resp.status_code == 200:
                    return resp.json().get("findings", [])
                return None
        except Exception as e:
            logger.error(f"Get findings error: {e}")
            return None

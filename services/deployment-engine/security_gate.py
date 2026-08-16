"""
Security Gate — Pre-Deployment Security Validation

Implements the deployment pipeline security gate:
  Source → Secret Scan → Dependency Scan → Code Scan → Build Config Check → PASS/BLOCK

This module evaluates scan results against deployment policies
and produces a gate decision (deploy / block / warn).
"""
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum

logger = logging.getLogger(__name__)


class GateDecision(str, Enum):
    DEPLOY = "deploy"
    BLOCK = "block"
    WARN = "warn"


@dataclass
class PolicyViolation:
    rule: str
    severity: str
    description: str
    finding_count: int = 0


@dataclass
class GateResult:
    """Result of security gate evaluation"""
    passed: bool
    decision: GateDecision
    reason: str
    violations: List[PolicyViolation] = field(default_factory=list)
    critical_findings: int = 0
    high_findings: int = 0
    medium_findings: int = 0
    low_findings: int = 0
    scans_evaluated: int = 0


@dataclass
class DeploymentPolicy:
    """
    Configurable deployment security policy.

    Defines thresholds that determine whether a deployment is allowed.
    Can be configured per-tenant or per-deployment.
    """
    # Block if any critical findings exist
    block_on_critical: bool = True
    # Block if high findings exceed this count
    max_high_findings: int = 0
    # Block if medium findings exceed this count (0 = no limit)
    max_medium_findings: int = 0
    # Block if secrets are detected in source
    block_on_secrets: bool = True
    # Block if critical CVEs found in dependencies
    block_on_critical_cves: bool = True
    # Require scan to be completed before deploy (vs allowing deploy with warning)
    require_scan_completion: bool = True
    # Allow deployment with warnings (decision=warn instead of block)
    allow_warnings: bool = True


# Default policy — strict for production
DEFAULT_POLICY = DeploymentPolicy(
    block_on_critical=True,
    max_high_findings=0,
    max_medium_findings=10,
    block_on_secrets=True,
    block_on_critical_cves=True,
    require_scan_completion=True,
    allow_warnings=True,
)

# Relaxed policy for development environments
DEV_POLICY = DeploymentPolicy(
    block_on_critical=True,
    max_high_findings=5,
    max_medium_findings=0,  # no limit
    block_on_secrets=True,
    block_on_critical_cves=True,
    require_scan_completion=False,
    allow_warnings=True,
)


def evaluate_gate(
    findings: List[Dict[str, Any]],
    policy: Optional[DeploymentPolicy] = None,
) -> GateResult:
    """
    Evaluate security findings against deployment policy.

    Args:
        findings: List of finding dicts with at minimum 'severity' and 'type' keys
        policy: Deployment policy to evaluate against (defaults to DEFAULT_POLICY)

    Returns:
        GateResult with decision and details
    """
    if policy is None:
        policy = DEFAULT_POLICY

    violations: List[PolicyViolation] = []

    # Count findings by severity
    critical = sum(1 for f in findings if f.get("severity") == "critical")
    high = sum(1 for f in findings if f.get("severity") == "high")
    medium = sum(1 for f in findings if f.get("severity") == "medium")
    low = sum(1 for f in findings if f.get("severity") == "low")

    # Check for secrets
    secrets = [f for f in findings if f.get("type") == "hardcoded_secret"]
    if policy.block_on_secrets and secrets:
        violations.append(PolicyViolation(
            rule="no_secrets",
            severity="critical",
            description=f"Found {len(secrets)} hardcoded secret(s) in source code",
            finding_count=len(secrets),
        ))

    # Check critical findings
    if policy.block_on_critical and critical > 0:
        violations.append(PolicyViolation(
            rule="no_critical_findings",
            severity="critical",
            description=f"Found {critical} critical security finding(s)",
            finding_count=critical,
        ))

    # Check critical CVEs
    critical_cves = [f for f in findings
                     if f.get("type") == "vulnerable_dependency"
                     and f.get("severity") == "critical"]
    if policy.block_on_critical_cves and critical_cves:
        violations.append(PolicyViolation(
            rule="no_critical_cves",
            severity="critical",
            description=f"Found {len(critical_cves)} critical CVE(s) in dependencies",
            finding_count=len(critical_cves),
        ))

    # Check high findings threshold
    if policy.max_high_findings > 0 and high > policy.max_high_findings:
        violations.append(PolicyViolation(
            rule="max_high_findings",
            severity="high",
            description=f"High findings ({high}) exceed threshold ({policy.max_high_findings})",
            finding_count=high,
        ))

    # Check medium findings threshold
    if policy.max_medium_findings > 0 and medium > policy.max_medium_findings:
        violations.append(PolicyViolation(
            rule="max_medium_findings",
            severity="medium",
            description=f"Medium findings ({medium}) exceed threshold ({policy.max_medium_findings})",
            finding_count=medium,
        ))

    # Determine decision
    has_critical_violation = any(v.severity == "critical" for v in violations)
    has_high_violation = any(v.severity == "high" for v in violations)

    if has_critical_violation:
        decision = GateDecision.BLOCK
        reason = "Blocked: critical security policy violations detected"
        passed = False
    elif has_high_violation:
        if policy.allow_warnings:
            decision = GateDecision.WARN
            reason = "Warning: high-severity policy violations detected (deployment allowed with risk)"
            passed = True
        else:
            decision = GateDecision.BLOCK
            reason = "Blocked: high-severity policy violations detected"
            passed = False
    elif violations:
        decision = GateDecision.WARN
        reason = "Warning: minor policy violations detected"
        passed = True
    else:
        decision = GateDecision.DEPLOY
        reason = "All security checks passed"
        passed = True

    logger.info(f"Security gate decision: {decision.value} ({len(violations)} violations)")

    return GateResult(
        passed=passed,
        decision=decision,
        reason=reason,
        violations=violations,
        critical_findings=critical,
        high_findings=high,
        medium_findings=medium,
        low_findings=low,
        scans_evaluated=1,
    )

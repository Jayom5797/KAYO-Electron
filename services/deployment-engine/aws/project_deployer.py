"""
KAYO AWS Project Deployer

Autonomous deployment controller that provisions independent
AWS infrastructure for each project using CloudFormation.

Each project receives:
- Dedicated VPC + networking
- Dedicated ECR repository
- Dedicated ECS/Fargate cluster + service
- Dedicated IAM roles (task + execution)
- Dedicated CloudWatch log group
- Independent lifecycle (deploy/stop/restart/delete)

Pipeline:
  Source → Validate → Assess → Gate → Build → Image Scan → Provision → Push → Deploy → Health → Register
"""
import os
import json
import time
import uuid
import logging
import subprocess
import tempfile
import shutil
from typing import Optional, Dict, Any, Tuple
from pathlib import Path
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
AWS_ACCOUNT_ID = os.environ.get("AWS_ACCOUNT_ID", "")
TEMPLATE_PATH = Path(__file__).parent / "templates" / "project-stack.yaml"


class DeploymentState(str, Enum):
    RECEIVED = "received"
    VALIDATING = "validating"
    ASSESSING = "assessing"
    GATE_BLOCKED = "gate_blocked"
    BUILDING = "building"
    IMAGE_SCANNING = "image_scanning"
    PROVISIONING = "provisioning"
    PUSHING_IMAGE = "pushing_image"
    DEPLOYING = "deploying"
    HEALTH_CHECK = "health_check"
    REGISTERING = "registering"
    MONITORING = "monitoring"
    ACTIVE = "active"
    STOPPED = "stopped"
    FAILED = "failed"
    DELETING = "deleting"
    DELETED = "deleted"


@dataclass
class ProjectDeployment:
    """Tracks a project deployment lifecycle."""
    project_id: str
    tenant_id: str
    project_name: str
    source_url: str
    source_type: str  # github, zip
    state: DeploymentState = DeploymentState.RECEIVED
    stack_name: Optional[str] = None
    ecr_repo: Optional[str] = None
    image_uri: Optional[str] = None
    image_digest: Optional[str] = None
    endpoint: Optional[str] = None
    scan_id: Optional[str] = None
    gate_result: Optional[Dict] = None
    image_scan_result: Optional[Dict] = None
    error: Optional[str] = None
    aws_outputs: Dict[str, str] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ"))


def get_account_id() -> str:
    """Get AWS account ID from STS."""
    global AWS_ACCOUNT_ID
    if AWS_ACCOUNT_ID:
        return AWS_ACCOUNT_ID
    try:
        result = subprocess.run(
            ["aws", "sts", "get-caller-identity", "--query", "Account", "--output", "text"],
            capture_output=True, text=True, timeout=10
        )
        AWS_ACCOUNT_ID = result.stdout.strip()
        return AWS_ACCOUNT_ID
    except Exception as e:
        logger.error(f"Failed to get AWS account ID: {e}")
        return ""


def create_ecr_repository(project_id: str) -> Optional[str]:
    """Create a project-specific ECR repository."""
    repo_name = f"kayo/project/{project_id}"
    try:
        result = subprocess.run(
            ["aws", "ecr", "create-repository",
             "--repository-name", repo_name,
             "--image-scanning-configuration", "scanOnPush=true",
             "--tags", f"Key=kayo:managed,Value=true", f"Key=kayo:project-id,Value={project_id}",
             "--region", AWS_REGION],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            uri = data["repository"]["repositoryUri"]
            logger.info(f"ECR repository created: {uri}")
            return uri
        elif "RepositoryAlreadyExistsException" in result.stderr:
            # Repository exists, get URI
            result2 = subprocess.run(
                ["aws", "ecr", "describe-repositories",
                 "--repository-names", repo_name,
                 "--query", "repositories[0].repositoryUri",
                 "--output", "text", "--region", AWS_REGION],
                capture_output=True, text=True, timeout=10
            )
            return result2.stdout.strip()
        else:
            logger.error(f"ECR creation failed: {result.stderr}")
            return None
    except Exception as e:
        logger.error(f"ECR creation error: {e}")
        return None


def build_and_push_image(project_id: str, source_dir: str, ecr_uri: str) -> Tuple[Optional[str], Optional[str]]:
    """Build Docker image and push to ECR. Returns (image_uri, digest)."""
    tag = f"{ecr_uri}:latest"

    # ECR login
    try:
        account_id = get_account_id()
        login_result = subprocess.run(
            ["aws", "ecr", "get-login-password", "--region", AWS_REGION],
            capture_output=True, text=True, timeout=10
        )
        if login_result.returncode != 0:
            logger.error(f"ECR login password failed: {login_result.stderr}")
            return None, None

        docker_login = subprocess.run(
            ["docker", "login", "--username", "AWS", "--password-stdin",
             f"{account_id}.dkr.ecr.{AWS_REGION}.amazonaws.com"],
            input=login_result.stdout, capture_output=True, text=True, timeout=15
        )
        if docker_login.returncode != 0:
            logger.error(f"Docker login failed: {docker_login.stderr}")
            return None, None
    except Exception as e:
        logger.error(f"ECR auth error: {e}")
        return None, None

    # Build
    logger.info(f"Building image for project {project_id}...")
    try:
        build_result = subprocess.run(
            ["docker", "build", "-t", tag, "."],
            capture_output=True, text=True, timeout=300, cwd=source_dir
        )
        if build_result.returncode != 0:
            logger.error(f"Docker build failed: {build_result.stderr[-500:]}")
            return None, None
        logger.info(f"Image built: {tag}")
    except subprocess.TimeoutExpired:
        logger.error("Docker build timed out")
        return None, None

    # Push
    logger.info(f"Pushing image to ECR...")
    try:
        push_result = subprocess.run(
            ["docker", "push", tag],
            capture_output=True, text=True, timeout=120
        )
        if push_result.returncode != 0:
            logger.error(f"Docker push failed: {push_result.stderr}")
            return None, None
        logger.info(f"Image pushed: {tag}")
    except subprocess.TimeoutExpired:
        logger.error("Docker push timed out")
        return None, None

    # Get digest
    try:
        digest_result = subprocess.run(
            ["aws", "ecr", "describe-images",
             "--repository-name", f"kayo/project/{project_id}",
             "--image-ids", "imageTag=latest",
             "--query", "imageDetails[0].imageDigest",
             "--output", "text", "--region", AWS_REGION],
            capture_output=True, text=True, timeout=10
        )
        digest = digest_result.stdout.strip() if digest_result.returncode == 0 else None
    except Exception:
        digest = None

    return tag, digest


def provision_project_stack(project_id: str, project_name: str, image_uri: str) -> Tuple[bool, Dict[str, str]]:
    """Create CloudFormation stack for project infrastructure."""
    stack_name = f"kayo-project-{project_id}"

    logger.info(f"Provisioning infrastructure stack: {stack_name}")
    try:
        result = subprocess.run(
            ["aws", "cloudformation", "create-stack",
             "--stack-name", stack_name,
             "--template-body", f"file://{TEMPLATE_PATH}",
             "--parameters",
             f"ParameterKey=ProjectId,ParameterValue={project_id}",
             f"ParameterKey=ProjectName,ParameterValue={project_name}",
             f"ParameterKey=ImageUri,ParameterValue={image_uri}",
             "--capabilities", "CAPABILITY_NAMED_IAM",
             "--tags", f"Key=kayo:managed,Value=true", f"Key=kayo:project-id,Value={project_id}",
             "--region", AWS_REGION],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0 and "AlreadyExistsException" not in result.stderr:
            logger.error(f"Stack creation failed: {result.stderr}")
            return False, {}
    except Exception as e:
        logger.error(f"Stack creation error: {e}")
        return False, {}

    # Wait for stack completion
    logger.info(f"Waiting for stack {stack_name} to complete...")
    try:
        wait_result = subprocess.run(
            ["aws", "cloudformation", "wait", "stack-create-complete",
             "--stack-name", stack_name, "--region", AWS_REGION],
            capture_output=True, text=True, timeout=600
        )
        if wait_result.returncode != 0:
            logger.error(f"Stack creation failed or timed out: {wait_result.stderr}")
            return False, {}
    except subprocess.TimeoutExpired:
        logger.error("Stack creation timed out (10 min)")
        return False, {}

    # Get outputs
    outputs = get_stack_outputs(stack_name)
    logger.info(f"Stack {stack_name} created successfully with {len(outputs)} outputs")
    return True, outputs


def get_stack_outputs(stack_name: str) -> Dict[str, str]:
    """Get CloudFormation stack outputs."""
    try:
        result = subprocess.run(
            ["aws", "cloudformation", "describe-stacks",
             "--stack-name", stack_name,
             "--query", "Stacks[0].Outputs",
             "--output", "json", "--region", AWS_REGION],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            outputs = json.loads(result.stdout)
            return {o["OutputKey"]: o["OutputValue"] for o in (outputs or [])}
    except Exception as e:
        logger.error(f"Failed to get stack outputs: {e}")
    return {}


def delete_project_stack(project_id: str) -> bool:
    """Delete a project's CloudFormation stack (complete teardown)."""
    stack_name = f"kayo-project-{project_id}"

    # Verify stack belongs to this project (tag check)
    try:
        result = subprocess.run(
            ["aws", "cloudformation", "describe-stacks",
             "--stack-name", stack_name, "--region", AWS_REGION],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            logger.warning(f"Stack {stack_name} not found")
            return True  # Already deleted

        stack_data = json.loads(result.stdout)
        tags = {t["Key"]: t["Value"] for t in stack_data["Stacks"][0].get("Tags", [])}
        if tags.get("kayo:project-id") != project_id:
            logger.error(f"Stack {stack_name} does not belong to project {project_id}!")
            return False
    except Exception as e:
        logger.error(f"Stack verification failed: {e}")
        return False

    # Delete ECR images first (CloudFormation can't delete non-empty repos)
    try:
        subprocess.run(
            ["aws", "ecr", "batch-delete-image",
             "--repository-name", f"kayo/project/{project_id}",
             "--image-ids", "imageTag=latest",
             "--region", AWS_REGION],
            capture_output=True, text=True, timeout=10
        )
    except Exception:
        pass

    # Delete stack
    logger.info(f"Deleting project stack: {stack_name}")
    try:
        result = subprocess.run(
            ["aws", "cloudformation", "delete-stack",
             "--stack-name", stack_name, "--region", AWS_REGION],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            logger.error(f"Stack deletion failed: {result.stderr}")
            return False

        # Wait for deletion
        subprocess.run(
            ["aws", "cloudformation", "wait", "stack-delete-complete",
             "--stack-name", stack_name, "--region", AWS_REGION],
            capture_output=True, text=True, timeout=600
        )
        logger.info(f"Stack {stack_name} deleted successfully")
        return True
    except Exception as e:
        logger.error(f"Stack deletion error: {e}")
        return False


def scan_image_trivy(image_uri: str) -> Dict[str, Any]:
    """Scan container image with Trivy for vulnerabilities."""
    try:
        result = subprocess.run(
            ["trivy", "image", "--format", "json", "--severity", "CRITICAL,HIGH", image_uri],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            data = json.loads(result.stdout)
            vulns = []
            for r in data.get("Results", []):
                for v in r.get("Vulnerabilities", []):
                    vulns.append({
                        "id": v.get("VulnerabilityID"),
                        "package": v.get("PkgName"),
                        "severity": v.get("Severity", "").lower(),
                        "title": v.get("Title", ""),
                        "fixed_version": v.get("FixedVersion"),
                    })
            return {"success": True, "vulnerabilities": vulns, "critical": sum(1 for v in vulns if v["severity"] == "critical"), "high": sum(1 for v in vulns if v["severity"] == "high")}
        else:
            # Trivy not available — log but don't block
            logger.warning(f"Trivy scan failed (may not be installed): {result.stderr[:200]}")
            return {"success": False, "error": "Trivy not available", "vulnerabilities": []}
    except FileNotFoundError:
        logger.warning("Trivy not installed — image scanning skipped")
        return {"success": False, "error": "Trivy not installed", "vulnerabilities": []}
    except Exception as e:
        logger.warning(f"Image scan error: {e}")
        return {"success": False, "error": str(e), "vulnerabilities": []}

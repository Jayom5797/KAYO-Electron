"""
Assessment Engine Client

Communicates with the KAYO Assessment Engine (Node.js service) via HTTP.
Used by the control plane to trigger scans and retrieve results.
"""
import httpx
import logging
from typing import Optional, Dict, Any, List
from config import settings

logger = logging.getLogger(__name__)

ASSESSMENT_ENGINE_URL = getattr(settings, 'assessment_engine_url', 'http://localhost:3100')
SERVICE_TOKEN = getattr(settings, 'service_token', 'dev-token')


class AssessmentClient:
    """HTTP client for the Assessment Engine service."""

    def __init__(self, base_url: str = None, token: str = None):
        self.base_url = base_url or ASSESSMENT_ENGINE_URL
        self.token = token or SERVICE_TOKEN
        self.headers = {
            'x-kayo-service-token': self.token,
            'Content-Type': 'application/json',
        }

    async def assess_url(
        self,
        url: str,
        tenant_id: str,
        active_scan: bool = False,
        timeout_ms: int = 30000,
    ) -> Dict[str, Any]:
        """
        Trigger a URL security assessment.

        Returns: {"scan_id": "...", "status": "running"}
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.base_url}/assess/url",
                headers=self.headers,
                json={
                    "url": url,
                    "tenant_id": tenant_id,
                    "active_scan": active_scan,
                    "timeout_ms": timeout_ms,
                },
            )
            response.raise_for_status()
            return response.json()

    async def assess_repository(
        self,
        url: str,
        tenant_id: str,
        advanced: bool = False,
        github_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Trigger a repository security assessment.

        Returns: {"scan_id": "...", "status": "running"}
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.base_url}/assess/repository",
                headers=self.headers,
                json={
                    "url": url,
                    "tenant_id": tenant_id,
                    "advanced": advanced,
                    "token": github_token,
                },
            )
            response.raise_for_status()
            return response.json()

    async def get_scan_status(self, scan_id: str) -> Dict[str, Any]:
        """Get current scan status and posture."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{self.base_url}/assess/{scan_id}",
                headers=self.headers,
            )
            response.raise_for_status()
            return response.json()

    async def get_findings(self, scan_id: str) -> List[Dict[str, Any]]:
        """Get canonical findings for a completed scan."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{self.base_url}/assess/{scan_id}/findings",
                headers=self.headers,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("findings", [])

    async def get_report(self, scan_id: str, format: str = "markdown") -> Dict[str, Any]:
        """Get formatted report for a completed scan."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{self.base_url}/assess/{scan_id}/report",
                headers=self.headers,
                params={"format": format},
            )
            response.raise_for_status()
            return response.json()

    async def poll_until_complete(
        self, scan_id: str, max_attempts: int = 60, interval_s: float = 2.0
    ) -> Dict[str, Any]:
        """
        Poll scan status until completed or failed.
        Returns final status dict.
        """
        import asyncio

        for _ in range(max_attempts):
            status = await self.get_scan_status(scan_id)
            if status.get("status") in ("completed", "failed"):
                return status
            await asyncio.sleep(interval_s)

        return {"status": "timeout", "scan_id": scan_id}

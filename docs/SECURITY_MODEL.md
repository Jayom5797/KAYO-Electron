# KAYO Security Model

## Authentication & Authorization

- **Method**: JWT (HS256) with tenant_id and role claims
- **Roles**: admin, member
- **Multi-tenancy**: All data queries filtered by tenant_id
- **Rate limiting**: Redis sliding window (per tenant tier)

## SSRF Protection (Assessment Engine)

The assessment engine accepts arbitrary URLs — an inherent SSRF risk.

### Implemented Mitigations
1. **URL validation** — Only HTTP/HTTPS allowed
2. **Private IP blocking** — RFC 1918, loopback, link-local blocked
3. **Cloud metadata blocking** — 169.254.169.254 and equivalents blocked
4. **Dangerous protocol blocking** — file://, ftp://, gopher://, etc.
5. **Length limits** — URLs capped at 2048 characters
6. **Localhost blocking** — localhost and variants blocked

### Recommended Additional Measures (not yet implemented)
- DNS resolution check (resolve hostname, verify IP is not private)
- DNS rebinding protection (pin resolved IP)
- Network isolation (assessment engine in isolated subnet)
- Egress filtering (only allow port 80/443 outbound)
- Request timeout enforcement at network layer

## Archive Handling

ZIP uploads use `safe_extract.py` which provides:
- Path traversal prevention (zip-slip)
- Size limits (500 MB max)
- File count limits (10,000 max)
- Symlink rejection
- Dangerous extension detection

## Active Scanning

Active vulnerability scanning (SQLi, XSS probes) is destructive and:
- Requires explicit `active_scan: true` flag
- Must only target authorized systems
- Is logged in audit trail

## Credential Handling

- **No credentials in repository** — All secrets via environment variables or K8s Secrets
- **SEVE GCP key NOT copied** — Identified as compromised in Phase 1 audit
- **AI service**: Redacts sensitive data before sending to external LLM providers
- **JWT in WebSocket**: Token in query parameter (acceptable for WS, logged)

## Deployment Security

- Security gate evaluates findings before allowing deployment
- Untrusted source code never executed on control plane
- Container builds use Kaniko (no Docker socket access)
- Deployed containers run as non-root
- Tenant isolation via Kubernetes namespaces + network policies

## Known Unresolved Issues

1. CORS wildcard (`allow_origins=["*"]`) in control-plane — needs domain restriction for production
2. Unauthenticated tenant creation endpoint — acceptable for signup flow but needs rate limiting
3. DNS rebinding not fully mitigated in SSRF guard
4. No container image scanning (Trivy/Snyk) in deployment pipeline yet

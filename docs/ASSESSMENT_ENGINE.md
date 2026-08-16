# KAYO Assessment Engine

## Overview

The Assessment Engine performs on-demand security analysis of URLs and repositories. It is the "ASSESS" capability of the KAYO lifecycle.

## Capabilities

### URL Assessment (Passive)
- Browser-based network capture (Playwright/Chromium)
- TLS certificate and cipher analysis
- Security header analysis (HSTS, CSP, X-Frame-Options, etc.)
- Content-Security-Policy grading
- CORS misconfiguration detection
- Cookie security flag audit
- Mixed content detection
- Technology fingerprinting
- CVE correlation (via OSV.dev)
- API endpoint discovery
- JWT token analysis
- Sensitive data exposure detection
- DNS reconnaissance
- CMS attack surface analysis

### URL Assessment (Active — requires authorization)
- SQL injection testing
- XSS detection
- IDOR testing
- Path traversal
- Open redirect detection
- Information disclosure

### Repository Assessment
- Secret scanning (AWS keys, GitHub tokens, private keys, etc.)
- Dependency vulnerability analysis (npm, PyPI, Go, RubyGems via OSV.dev)
- GitHub Actions workflow security
- Repository hygiene checks
- Insecure code pattern detection
- Code quality/health scoring

## Architecture

```
Control Plane ──HTTP──→ Assessment Engine (:3100)
                              │
                         ┌────┴────┐
                         │ ASTRA   │
                         │ Modules │
                         └────┬────┘
                              │
                    ┌─────────┼─────────┐
                    │         │         │
                    ▼         ▼         ▼
              Playwright  Security   Repo
              (Chromium)  Modules   Scanner
```

## API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/assess/url` | Trigger URL scan |
| POST | `/assess/repository` | Trigger repo scan |
| GET | `/assess/:id` | Scan status |
| GET | `/assess/:id/findings` | Canonical findings |
| GET | `/assess/:id/report` | Formatted report |
| GET | `/health` | Health check |

## Docker Packaging

The Dockerfile pins the Playwright version and installs Chromium during build:
```dockerfile
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.browsers
RUN npx playwright install chromium --with-deps
```

This ensures reproducible builds regardless of the host machine's browser cache.

## SSRF Protection

All URL inputs pass through `ssrf-guard.ts` which blocks:
- Private IP ranges (RFC 1918)
- Loopback/localhost
- Cloud metadata endpoints (169.254.169.254)
- Dangerous protocols (file://, ftp://, gopher://)

## Security Model

- Service-to-service authentication via `x-kayo-service-token`
- Active scanning requires explicit `active_scan: true` flag
- All findings normalized to canonical KAYO schema before returning
- No direct database access — findings stored by Control Plane

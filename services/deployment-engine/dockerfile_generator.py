"""
Dockerfile Generator

Extracted from: SEVE-SaaS/kayo_deploy.py (DOCKERFILES dict + write_dockerfile)
Purpose: Generate appropriate Dockerfiles for detected stacks.

Changes from original:
- Removed GCP-specific references
- Added security best practices (non-root user, multi-stage builds)
- Made templates more configurable
- Added .dockerignore generation
"""
import os
from typing import Optional
from stack_detector import StackInfo


# ── Dockerfile Templates ───────────────────────────────────────────────────────

TEMPLATES = {
    "node-spa": """# Multi-stage build: build SPA then serve with nginx
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
RUN adduser -D -g '' appuser
COPY --from=builder /app/{build_dir} /usr/share/nginx/html
RUN echo 'server {{ listen 8080; location / {{ root /usr/share/nginx/html; try_files $uri $uri/ /index.html; }} }}' > /etc/nginx/conf.d/default.conf
EXPOSE 8080
USER appuser
CMD ["nginx", "-g", "daemon off;"]
""",

    "node-server": """FROM node:20-alpine
RUN adduser -D -g '' appuser
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV PORT=8080
EXPOSE 8080
USER appuser
CMD ["node", "{entry}"]
""",

    "node-next": """FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
RUN adduser -D -g '' appuser
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
ENV PORT=8080
EXPOSE 8080
USER appuser
CMD ["npm", "start"]
""",

    "node-generic": """FROM node:20-alpine
RUN adduser -D -g '' appuser
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
ENV PORT=8080
EXPOSE 8080
USER appuser
CMD ["npm", "start"]
""",

    "python-fastapi": """FROM python:3.12-slim
RUN useradd -m -s /bin/bash appuser
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8080
EXPOSE 8080
USER appuser
CMD ["uvicorn", "{entry}:app", "--host", "0.0.0.0", "--port", "8080"]
""",

    "python-flask": """FROM python:3.12-slim
RUN useradd -m -s /bin/bash appuser
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY . .
ENV PORT=8080
EXPOSE 8080
USER appuser
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "{entry}:app"]
""",

    "python-django": """FROM python:3.12-slim
RUN useradd -m -s /bin/bash appuser
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn
COPY . .
RUN python manage.py collectstatic --noinput 2>/dev/null || true
ENV PORT=8080
EXPOSE 8080
USER appuser
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "{entry}.wsgi:application"]
""",

    "python-generic": """FROM python:3.12-slim
RUN useradd -m -s /bin/bash appuser
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8080
EXPOSE 8080
USER appuser
CMD ["python", "{entry}"]
""",

    "static": """FROM nginx:alpine
RUN adduser -D -g '' appuser
COPY . /usr/share/nginx/html
RUN sed -i 's/listen       80;/listen       8080;/' /etc/nginx/conf.d/default.conf
EXPOSE 8080
USER appuser
CMD ["nginx", "-g", "daemon off;"]
""",
}

DOCKERIGNORE = """node_modules
.git
.env
.env.*
*.log
dist
build
.next
__pycache__
*.pyc
.pytest_cache
.venv
venv
.DS_Store
Thumbs.db
"""


def generate_dockerfile(src_dir: str, stack: StackInfo) -> Optional[str]:
    """
    Generate a Dockerfile for the given stack.

    If a Dockerfile already exists in src_dir, returns None (use existing).

    Args:
        src_dir: Source directory path
        stack: Detected stack information

    Returns:
        Generated Dockerfile content, or None if one already exists
    """
    # Don't overwrite existing Dockerfiles
    if os.path.exists(os.path.join(src_dir, "Dockerfile")):
        return None

    template_key = _get_template_key(stack)
    if template_key not in TEMPLATES:
        return None

    template = TEMPLATES[template_key]

    # Substitute placeholders
    entry = stack.entry_point or "index.js" if stack.runtime == "node" else "main"
    # For Python entry points, strip .py extension for module-style imports
    if stack.runtime == "python" and entry.endswith(".py"):
        entry_module = entry[:-3]
    else:
        entry_module = entry

    dockerfile = template.replace("{entry}", entry_module if stack.runtime == "python" else entry)
    dockerfile = dockerfile.replace("{build_dir}", stack.build_output_dir or "dist")

    return dockerfile


def generate_dockerignore(src_dir: str) -> Optional[str]:
    """Generate a .dockerignore file if one doesn't exist."""
    if os.path.exists(os.path.join(src_dir, ".dockerignore")):
        return None
    return DOCKERIGNORE


def write_build_files(src_dir: str, stack: StackInfo) -> dict:
    """
    Write Dockerfile and .dockerignore to the source directory.

    Returns dict with what was written.
    """
    result = {"dockerfile_written": False, "dockerignore_written": False}

    dockerfile = generate_dockerfile(src_dir, stack)
    if dockerfile:
        with open(os.path.join(src_dir, "Dockerfile"), "w") as f:
            f.write(dockerfile)
        result["dockerfile_written"] = True

    dockerignore = generate_dockerignore(src_dir)
    if dockerignore:
        with open(os.path.join(src_dir, ".dockerignore"), "w") as f:
            f.write(dockerignore)
        result["dockerignore_written"] = True

    return result


def _get_template_key(stack: StackInfo) -> str:
    """Map StackInfo to template key."""
    if stack.runtime == "docker":
        return ""  # Use existing Dockerfile

    if stack.runtime == "node":
        if stack.framework == "next":
            return "node-next"
        if stack.variant == "spa":
            return "node-spa"
        if stack.variant == "server":
            return "node-server"
        return "node-generic"

    if stack.runtime == "python":
        if stack.framework == "fastapi":
            return "python-fastapi"
        if stack.framework == "flask":
            return "python-flask"
        if stack.framework == "django":
            return "python-django"
        return "python-generic"

    if stack.runtime == "static":
        return "static"

    return ""

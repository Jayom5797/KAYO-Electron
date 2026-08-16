"""
Stack Detection Module

Extracted from: SEVE-SaaS/kayo_deploy.py (detect_stack function)
Purpose: Automatically detect the technology stack of a source project
         to determine appropriate build and deployment configuration.

Changes from original:
- Removed GCP-specific logic
- Added type hints and documentation
- Made framework detection more robust
- Returns structured StackInfo instead of tuple
"""
import os
import json
from dataclasses import dataclass, field
from typing import Optional, Dict, List


@dataclass
class StackInfo:
    """Detected stack information for a source project"""
    runtime: str  # node, python, static, unknown
    framework: Optional[str] = None  # express, fastapi, next, flask, etc.
    variant: Optional[str] = None  # spa, server, generic
    entry_point: Optional[str] = None  # main file
    build_output_dir: Optional[str] = None  # for SPAs
    port: int = 8080
    package_data: Dict = field(default_factory=dict)
    detected_services: List[str] = field(default_factory=list)


def detect_stack(src_dir: str) -> StackInfo:
    """
    Detect the technology stack of a source directory.

    Scans for package.json (Node.js), requirements.txt/pyproject.toml (Python),
    or index.html (static) to determine the stack.

    Args:
        src_dir: Path to the source directory

    Returns:
        StackInfo with detected stack details
    """
    files = [f.lower() for f in os.listdir(src_dir)]

    # ── Node.js Detection ──────────────────────────────────────────────────
    if "package.json" in files:
        return _detect_node_stack(src_dir)

    # ── Python Detection ───────────────────────────────────────────────────
    if "requirements.txt" in files or "pyproject.toml" in files:
        return _detect_python_stack(src_dir)

    # ── Static Site ────────────────────────────────────────────────────────
    if "index.html" in files:
        return StackInfo(runtime="static", variant="static", entry_point="index.html")

    # ── Dockerfile present (use as-is) ────────────────────────────────────
    if "dockerfile" in files:
        return StackInfo(runtime="docker", variant="custom", entry_point="Dockerfile")

    return StackInfo(runtime="unknown")


def _detect_node_stack(src_dir: str) -> StackInfo:
    """Detect Node.js framework and variant."""
    try:
        with open(os.path.join(src_dir, "package.json"), "r") as f:
            pkg = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError):
        return StackInfo(runtime="node", variant="generic", package_data={})

    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    scripts = pkg.get("scripts", {})

    info = StackInfo(runtime="node", package_data=pkg)

    # Detect SPA frameworks
    spa_indicators = ["vite", "@vitejs/plugin-react", "@vitejs/plugin-vue",
                      "react-scripts", "@sveltejs/kit"]
    is_spa = any(k in deps for k in spa_indicators)
    has_server = any(k in deps for k in ["express", "fastify", "koa", "hapi", "nest"])

    if "next" in deps:
        info.framework = "next"
        info.variant = "server"
        info.entry_point = "next.config.js"
        return info

    if is_spa and not has_server:
        info.variant = "spa"
        info.framework = "vite" if "vite" in deps else "react" if "react-scripts" in deps else "svelte"
        # Determine build output directory
        if "react-scripts" in deps:
            info.build_output_dir = "build"
        else:
            info.build_output_dir = "dist"
        return info

    # Server frameworks
    if "express" in deps:
        info.framework = "express"
        info.variant = "server"
    elif "fastify" in deps:
        info.framework = "fastify"
        info.variant = "server"
    elif "koa" in deps:
        info.framework = "koa"
        info.variant = "server"
    elif "@nestjs/core" in deps:
        info.framework = "nest"
        info.variant = "server"
    else:
        info.variant = "generic"

    # Find entry point
    info.entry_point = _find_node_entry(src_dir, pkg)

    return info


def _detect_python_stack(src_dir: str) -> StackInfo:
    """Detect Python framework."""
    info = StackInfo(runtime="python")

    req_file = os.path.join(src_dir, "requirements.txt")
    if os.path.exists(req_file):
        with open(req_file, "r") as f:
            reqs = f.read().lower()

        if "fastapi" in reqs:
            info.framework = "fastapi"
            info.variant = "server"
        elif "flask" in reqs:
            info.framework = "flask"
            info.variant = "server"
        elif "django" in reqs:
            info.framework = "django"
            info.variant = "server"
        else:
            info.variant = "generic"

    # Find entry point
    info.entry_point = _find_python_entry(src_dir, info.framework)

    return info


def _find_node_entry(src_dir: str, pkg: Dict) -> str:
    """Find the Node.js entry point file."""
    # Check package.json main field
    main = pkg.get("main")
    if main and os.path.exists(os.path.join(src_dir, main)):
        return main

    # Check scripts.start
    start_script = pkg.get("scripts", {}).get("start", "")
    if "node " in start_script:
        candidate = start_script.split("node ")[-1].strip().split(" ")[0]
        if os.path.exists(os.path.join(src_dir, candidate)):
            return candidate

    # Common entry points
    for candidate in ["index.js", "app.js", "server.js", "src/index.js", "src/app.js"]:
        if os.path.exists(os.path.join(src_dir, candidate)):
            return candidate

    return "index.js"


def _find_python_entry(src_dir: str, framework: Optional[str]) -> str:
    """Find the Python entry point file."""
    if framework == "django":
        # Look for manage.py
        if os.path.exists(os.path.join(src_dir, "manage.py")):
            return "manage.py"

    for candidate in ["main.py", "app.py", "run.py", "server.py", "wsgi.py"]:
        if os.path.exists(os.path.join(src_dir, candidate)):
            return candidate

    return "main.py"

# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for KAYO Control Plane standalone backend.

Produces: kayo-backend.exe (with --onedir distribution)
Contains: Python 3.11 + FastAPI + all KAYO control plane code
"""
import os
import sys

CONTROL_PLANE = os.path.abspath(os.path.join(SPECPATH, '..', '..', 'services', 'control-plane'))

a = Analysis(
    [os.path.join(CONTROL_PLANE, 'desktop_entry.py')],
    pathex=[CONTROL_PLANE],
    binaries=[],
    datas=[
        (os.path.join(CONTROL_PLANE, 'api'), 'api'),
        (os.path.join(CONTROL_PLANE, 'models'), 'models'),
        (os.path.join(CONTROL_PLANE, 'schemas'), 'schemas'),
        (os.path.join(CONTROL_PLANE, 'services'), 'services'),
        (os.path.join(CONTROL_PLANE, 'config.py'), '.'),
        (os.path.join(CONTROL_PLANE, 'database.py'), '.'),
        (os.path.join(CONTROL_PLANE, 'main.py'), '.'),
        (os.path.join(CONTROL_PLANE, 'metrics.py'), '.'),
        (os.path.join(CONTROL_PLANE, 'seed_user.py'), '.'),
    ],
    hiddenimports=[
        'uvicorn', 'uvicorn.logging', 'uvicorn.loops', 'uvicorn.loops.auto',
        'uvicorn.loops.asyncio', 'uvicorn.protocols', 'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto', 'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.http.httptools_impl', 'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto', 'uvicorn.protocols.websockets.wsproto_impl',
        'uvicorn.lifespan', 'uvicorn.lifespan.on', 'uvicorn.lifespan.off',
        'fastapi', 'fastapi.routing', 'fastapi.middleware', 'fastapi.middleware.cors',
        'fastapi.responses', 'fastapi.security',
        'starlette', 'starlette.routing', 'starlette.middleware',
        'starlette.responses', 'starlette.websockets', 'starlette.status',
        'pydantic', 'pydantic_settings', 'pydantic_core',
        'passlib', 'passlib.handlers', 'passlib.handlers.bcrypt',
        'jose', 'jose.jwt', 'jose.jws', 'jose.constants',
        'sqlalchemy', 'sqlalchemy.orm', 'sqlalchemy.ext.declarative',
        'sqlalchemy.dialects.postgresql', 'sqlalchemy.dialects.postgresql.psycopg2',
        'psycopg2', 'psycopg2._psycopg', 'psycopg2.extensions', 'psycopg2.extras',
        'redis', 'redis.asyncio',
        'httpx', 'httpx._transports', 'httpcore',
        'anyio', 'anyio._backends', 'anyio._backends._asyncio',
        'multipart', 'python_multipart',
        'email_validator',
        'annotated_types',
        'h11', 'httptools', 'websockets', 'wsproto',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'scipy', 'numpy', 'PIL', 'IPython', 'pytest'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='kayo-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='kayo-backend',
)

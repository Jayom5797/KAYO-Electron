"""
Build the KAYO Control Plane into a standalone Windows executable using PyInstaller.

This produces a single-file executable that:
- Embeds the Python runtime
- Includes all FastAPI dependencies
- Starts uvicorn on 127.0.0.1:8000
- Requires no system Python installation

Usage:
  python build-backend.py

Output:
  dist/kayo-backend.exe
"""
import subprocess
import sys
import os

CONTROL_PLANE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'services', 'control-plane'))

# Create a launcher script that PyInstaller can bundle
LAUNCHER = '''
import os
import sys

# Set working directory to where the exe is
if getattr(sys, 'frozen', False):
    os.chdir(os.path.dirname(sys.executable))

# Set default environment for desktop mode
os.environ.setdefault('KAYO_MODE', 'desktop')
os.environ.setdefault('DEBUG', 'true')

import uvicorn

if __name__ == '__main__':
    host = os.environ.get('KAYO_HOST', '127.0.0.1')
    port = int(os.environ.get('KAYO_PORT', '8000'))
    print(f"KAYO Control Plane starting on {host}:{port}")
    uvicorn.run("main:app", host=host, port=port, log_level="info")
'''

def build():
    # Write launcher
    launcher_path = os.path.join(CONTROL_PLANE_DIR, '_launcher.py')
    with open(launcher_path, 'w') as f:
        f.write(LAUNCHER)

    # Run PyInstaller
    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--onefile',
        '--name', 'kayo-backend',
        '--distpath', os.path.join(os.path.dirname(__file__), 'dist'),
        '--workpath', os.path.join(os.path.dirname(__file__), 'build-tmp'),
        '--specpath', os.path.join(os.path.dirname(__file__), 'build-tmp'),
        '--add-data', f'{CONTROL_PLANE_DIR}{os.pathsep}.',
        '--hidden-import', 'uvicorn.logging',
        '--hidden-import', 'uvicorn.loops',
        '--hidden-import', 'uvicorn.loops.auto',
        '--hidden-import', 'uvicorn.protocols',
        '--hidden-import', 'uvicorn.protocols.http',
        '--hidden-import', 'uvicorn.protocols.http.auto',
        '--hidden-import', 'uvicorn.protocols.websockets',
        '--hidden-import', 'uvicorn.protocols.websockets.auto',
        '--hidden-import', 'uvicorn.lifespan',
        '--hidden-import', 'uvicorn.lifespan.on',
        '--hidden-import', 'passlib.handlers.bcrypt',
        '--hidden-import', 'jose',
        '--hidden-import', 'sqlalchemy.dialects.postgresql',
        '--collect-submodules', 'fastapi',
        '--collect-submodules', 'pydantic',
        '--noconfirm',
        launcher_path,
    ]

    print("Building KAYO backend executable...")
    print(f"Source: {CONTROL_PLANE_DIR}")
    result = subprocess.run(cmd, cwd=CONTROL_PLANE_DIR)

    # Cleanup
    os.remove(launcher_path)

    if result.returncode == 0:
        exe_path = os.path.join(os.path.dirname(__file__), 'dist', 'kayo-backend.exe')
        print(f"\nBuild successful: {exe_path}")
        print(f"Size: {os.path.getsize(exe_path) / 1024 / 1024:.1f} MB")
    else:
        print("\nBuild FAILED")
        sys.exit(1)


if __name__ == '__main__':
    build()

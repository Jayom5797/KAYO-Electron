"""
KAYO Desktop Entry Point

Starts the Control Plane for desktop mode.
Binds to 127.0.0.1 only (local-only, not publicly accessible).
"""
import os
import sys

# Set defaults for desktop mode before any imports
os.environ.setdefault('KAYO_MODE', 'desktop')
os.environ.setdefault('DEBUG', 'true')

def main():
    # When frozen (PyInstaller), set up paths for bundled source
    if getattr(sys, 'frozen', False):
        base = os.path.dirname(sys.executable)
        internal = os.path.join(base, '_internal')
        if os.path.exists(internal):
            os.chdir(internal)
            # Add _internal to sys.path so 'main' module can be found
            if internal not in sys.path:
                sys.path.insert(0, internal)
    
    host = os.environ.get('KAYO_HOST', '127.0.0.1')
    port = int(os.environ.get('KAYO_PORT', '8000'))
    print(f"KAYO Control Plane starting on {host}:{port}")
    
    # Import the app DIRECTLY (not as a string) so PyInstaller's
    # import system resolves it properly in frozen mode
    from main import app
    
    import uvicorn
    uvicorn.run(app, host=host, port=port, log_level="info")

if __name__ == '__main__':
    main()

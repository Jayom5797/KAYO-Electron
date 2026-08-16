/**
 * KAYO Desktop — Electron Main Process
 *
 * Architecture:
 *   Electron (this file)
 *     → BrowserWindow loads Next.js UI
 *     → Local Control Plane managed as child process
 *     → All AWS/backend operations stay in backend processes
 *
 * Security Model:
 *   - contextIsolation: true
 *   - nodeIntegration: false
 *   - Control Plane binds to 127.0.0.1 only
 *   - No AWS credentials reach the renderer
 *   - Authentication still required even for local access
 */
const { app, BrowserWindow, shell, Menu, nativeTheme, ipcMain } = require('electron');
const path = require('path');
const { spawn, fork } = require('child_process');
const http = require('http');
const net = require('net');
const { RuntimeManager } = require('./runtime/manager');

// ── Configuration ─────────────────────────────────────────────────────────────
const CONTROL_PLANE_HOST = '127.0.0.1';
const CONTROL_PLANE_PORT = process.env.KAYO_PORT || 8000;
const CONTROL_PLANE_URL = `http://${CONTROL_PLANE_HOST}:${CONTROL_PLANE_PORT}`;
const NEXT_DEV_PORT = 3000;
const IS_DEV = process.env.KAYO_MODE === 'development' || !app.isPackaged;

let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let backendStarted = false;
let nextProcess = null;
let nextPort = NEXT_DEV_PORT;
let runtimeManager = null;

// ── Backend Lifecycle ─────────────────────────────────────────────────────────

function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${CONTROL_PLANE_URL}/health`, { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForBackend(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const healthy = await checkBackendHealth();
    if (healthy) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

function startBackend() {
  // Only start if not already running externally
  return new Promise(async (resolve) => {
    const alreadyRunning = await checkBackendHealth();
    if (alreadyRunning) {
      console.log('[KAYO] Control Plane already running at', CONTROL_PLANE_URL);
      backendStarted = false; // We didn't start it
      resolve(true);
      return;
    }

    console.log('[KAYO] Starting local Control Plane...');

    // Determine how to start the backend
    const fs = require('fs');
    const backendExe = app.isPackaged
      ? path.join(process.resourcesPath, 'backend', 'kayo-backend.exe')
      : path.join(__dirname, 'dist', 'backend', 'kayo-backend', 'kayo-backend.exe');
    const controlPlaneDir = path.join(__dirname, '..', '..', 'services', 'control-plane');

    let cmd, args, cwd;

    if (fs.existsSync(backendExe)) {
      // Production: use packaged executable
      cmd = backendExe;
      args = [];
      cwd = path.dirname(backendExe);
      console.log('[KAYO] Using packaged backend:', backendExe);
    } else {
      // Development: use Python directly
      cmd = 'python';
      args = ['-m', 'uvicorn', 'main:app', '--host', CONTROL_PLANE_HOST, '--port', String(CONTROL_PLANE_PORT)];
      cwd = controlPlaneDir;
      console.log('[KAYO] Using development backend (Python)');
    }

    backendProcess = spawn(cmd, args, {
      cwd: cwd,
      env: {
        ...process.env,
        KAYO_MODE: 'desktop',
        KAYO_HOST: CONTROL_PLANE_HOST,
        KAYO_PORT: String(CONTROL_PLANE_PORT),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    backendProcess.stdout.on('data', (data) => {
      console.log('[CP]', data.toString().trim());
    });

    backendProcess.stderr.on('data', (data) => {
      console.log('[CP:err]', data.toString().trim());
    });

    backendProcess.on('error', (err) => {
      console.error('[KAYO] Failed to start Control Plane:', err.message);
      resolve(false);
    });

    backendProcess.on('exit', (code) => {
      console.log('[KAYO] Control Plane exited with code:', code);
      backendProcess = null;
    });

    backendStarted = true;

    // Wait for health
    const ready = await waitForBackend(20);
    if (ready) {
      console.log('[KAYO] Control Plane ready');
    } else {
      console.error('[KAYO] Control Plane failed to start within timeout');
    }
    resolve(ready);
  });
}

function stopBackend() {
  if (backendProcess && backendStarted) {
    console.log('[KAYO] Stopping Control Plane...');
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// ── Next.js Server Lifecycle ──────────────────────────────────────────────────

function getAvailablePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function startNextServer() {
  const fs = require('fs');

  // Check for packaged standalone server
  const standaloneDir = app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '..', 'web', '.next', 'standalone');
  const serverJs = path.join(standaloneDir, 'server.js');

  if (!IS_DEV && fs.existsSync(serverJs)) {
    // Production: run packaged standalone server using Electron's Node runtime
    nextPort = await getAvailablePort();
    console.log(`[KAYO] Starting packaged Next.js on port ${nextPort}...`);

    nextProcess = fork(serverJs, [], {
      cwd: standaloneDir,
      env: {
        ...process.env,
        PORT: String(nextPort),
        HOSTNAME: '127.0.0.1',
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${CONTROL_PLANE_PORT}`,
      },
      silent: true,
    });

    nextProcess.stdout.on('data', (d) => console.log('[NEXT]', d.toString().trim()));
    nextProcess.stderr.on('data', (d) => console.log('[NEXT:err]', d.toString().trim()));
    nextProcess.on('exit', (code) => { console.log('[KAYO] Next.js exited:', code); nextProcess = null; });

    // Wait for UI to be ready
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const ready = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${nextPort}`, { timeout: 2000 }, (res) => resolve(res.statusCode < 500));
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      if (ready) { console.log('[KAYO] Next.js ready'); return true; }
    }
    console.error('[KAYO] Next.js failed to start');
    return false;
  } else if (IS_DEV) {
    // Development: assume Next.js dev server is running externally
    nextPort = NEXT_DEV_PORT;
    console.log(`[KAYO] Dev mode: expecting Next.js at localhost:${nextPort}`);
    return true;
  } else {
    console.error('[KAYO] No packaged Next.js found at:', serverJs);
    return false;
  }
}

function stopNextServer() {
  if (nextProcess) {
    console.log('[KAYO] Stopping Next.js...');
    nextProcess.kill('SIGTERM');
    nextProcess = null;
  }
}

// ── Splash Screen ─────────────────────────────────────────────────────────────

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 400,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
  splashWindow.show();
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

// ── Window Creation ───────────────────────────────────────────────────────────

function createWindow() {
  nativeTheme.themeSource = 'dark';

  // Remove default menu bar for clean product appearance
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'KAYO',
      submenu: [
        { label: 'About KAYO', role: 'about' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: 'Dev Tools', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Zoom In', role: 'zoomIn' },
        { label: 'Zoom Out', role: 'zoomOut' },
        { label: 'Reset Zoom', role: 'resetZoom' },
      ]
    },
  ]));

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f1117',
    autoHideMenuBar: false,
    title: 'KAYO Security Workstation',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  // Load the Next.js UI
  if (IS_DEV) {
    // Development: load from Next.js dev server
    mainWindow.loadURL(`http://localhost:${NEXT_DEV_PORT}`);
  } else {
    // Production: load from packaged Next.js standalone server
    mainWindow.loadURL(`http://127.0.0.1:${nextPort || NEXT_DEV_PORT}`);
  }

  mainWindow.once('ready-to-show', () => {
    // Close splash and show main window
    closeSplash();
    mainWindow.show();
  });

  // Open external links in system browser (not inside Electron)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC Handlers (preload bridge) ─────────────────────────────────────────────

ipcMain.handle('kayo:getConfig', () => ({
  controlPlaneUrl: CONTROL_PLANE_URL,
  mode: IS_DEV ? 'development' : 'production',
  version: app.getVersion(),
}));

ipcMain.handle('kayo:checkHealth', async () => {
  return await checkBackendHealth();
});

ipcMain.handle('kayo:getRuntimeStatus', () => {
  if (runtimeManager) return runtimeManager.getStatus();
  return { state: 'unknown', services: {} };
});

// ── Application Lifecycle ─────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Show splash screen immediately
  createSplashWindow();

  // Initialize Runtime Manager for packaged mode
  const resourcesDir = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'dist');
  runtimeManager = new RuntimeManager(resourcesDir);

  if (app.isPackaged) {
    // Production: use Runtime Manager for full self-contained startup
    console.log('[KAYO] Production mode — using Runtime Manager');
    const ready = await runtimeManager.startAll((msg) => console.log(msg));
    if (!ready) {
      console.error('[KAYO] Runtime startup failed');
    }
  } else {
    // Development: use existing backend startup logic
    const backendReady = await startBackend();
    if (!backendReady) {
      console.warn('[KAYO] Starting UI without confirmed backend');
    }
  }

  // Start Next.js server (production mode)
  const uiReady = await startNextServer();
  if (!uiReady && !IS_DEV) {
    console.error('[KAYO] UI server failed to start');
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopNextServer();
  if (runtimeManager) {
    runtimeManager.stopAll();
  } else {
    stopBackend();
  }
});

app.on('quit', () => {
  stopNextServer();
  if (runtimeManager) {
    runtimeManager.stopAll();
  } else {
    stopBackend();
  }
});

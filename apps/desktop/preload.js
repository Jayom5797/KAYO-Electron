/**
 * KAYO Desktop — Preload Script
 *
 * Exposes a minimal, safe bridge between Electron main process
 * and the renderer (Next.js UI).
 *
 * Security:
 *   - contextIsolation: true (renderer cannot access Node.js)
 *   - Only exposes specific, audited APIs
 *   - No filesystem, shell, child_process access
 *   - No AWS credentials exposed
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kayo', {
  // Get KAYO desktop configuration
  getConfig: () => ipcRenderer.invoke('kayo:getConfig'),

  // Check if backend is healthy
  checkHealth: () => ipcRenderer.invoke('kayo:checkHealth'),

  // Platform info (safe to expose)
  platform: process.platform,
  isDesktop: true,
});

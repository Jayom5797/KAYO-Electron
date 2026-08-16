/**
 * KAYO Runtime Manager
 * 
 * Manages local Tier 1 services:
 *   - PostgreSQL (portable)
 *   - Redis (portable)
 *   - Assessment Engine (Electron Node)
 *   - Control Plane (kayo-backend.exe)
 * 
 * Responsibilities:
 *   - First-run initialization
 *   - Startup with dependency ordering
 *   - Health checking
 *   - Shutdown
 *   - Crash recovery
 *   - Port management
 */
const { spawn, fork, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), 'AppData', 'Local', 'KAYO');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const PG_DATA = path.join(DATA_DIR, 'data', 'postgres');
const REDIS_DATA = path.join(DATA_DIR, 'data', 'redis');

class RuntimeManager {
  constructor(resourcesPath) {
    this.resourcesPath = resourcesPath;
    this.services = {};
    this.state = 'stopped'; // stopped, starting, ready, degraded, critical
    this.onStateChange = null;

    // Ensure data directories exist
    [DATA_DIR, LOGS_DIR, PG_DATA, REDIS_DATA].forEach(dir => {
      fs.mkdirSync(dir, { recursive: true });
    });
  }

  // ── Port Management ─────────────────────────────────────────────────────

  async findAvailablePort(preferred) {
    return new Promise((resolve) => {
      const srv = net.createServer();
      srv.listen(preferred, '127.0.0.1', () => {
        srv.close(() => resolve(preferred));
      });
      srv.on('error', () => {
        // Preferred port taken, find a random one
        const srv2 = net.createServer();
        srv2.listen(0, '127.0.0.1', () => {
          const port = srv2.address().port;
          srv2.close(() => resolve(port));
        });
      });
    });
  }

  // ── Health Check ────────────────────────────────────────────────────────

  async checkHttp(port, path = '/health') {
    return new Promise((resolve) => {
      const req = http.get(`http://127.0.0.1:${port}${path}`, { timeout: 3000 }, (res) => {
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  async waitForPort(port, maxAttempts = 30, interval = 1000) {
    for (let i = 0; i < maxAttempts; i++) {
      const available = await new Promise((resolve) => {
        const sock = new net.Socket();
        sock.setTimeout(1000);
        sock.on('connect', () => { sock.destroy(); resolve(true); });
        sock.on('error', () => resolve(false));
        sock.on('timeout', () => { sock.destroy(); resolve(false); });
        sock.connect(port, '127.0.0.1');
      });
      if (available) return true;
      await new Promise(r => setTimeout(r, interval));
    }
    return false;
  }

  // ── PostgreSQL ──────────────────────────────────────────────────────────

  async startPostgres() {
    const pgBin = path.join(this.resourcesPath, 'runtime', 'postgres', 'bin');
    const pgCtl = path.join(pgBin, 'pg_ctl.exe');
    const initdb = path.join(pgBin, 'initdb.exe');

    if (!fs.existsSync(pgCtl)) {
      console.error('[RUNTIME] PostgreSQL binaries not found at:', pgBin);
      return false;
    }

    const port = await this.findAvailablePort(5555);

    // Set PATH so postgres/initdb can find their DLLs
    const pgLib = path.join(this.resourcesPath, 'runtime', 'postgres', 'lib');
    const pgEnv = { ...process.env, PATH: `${pgBin};${pgLib};${process.env.PATH}` };

    // First-run: initialize database
    if (!fs.existsSync(path.join(PG_DATA, 'PG_VERSION'))) {
      console.log('[RUNTIME] First run: initializing PostgreSQL...');
      try {
        execSync(`"${initdb}" -D "${PG_DATA}" -U kayo -A trust --encoding=UTF8`, {
          stdio: 'pipe', timeout: 30000, env: pgEnv
        });
        console.log('[RUNTIME] PostgreSQL initialized');
      } catch (e) {
        console.error('[RUNTIME] PostgreSQL init failed:', e.message);
        return false;
      }
    }

    // Start PostgreSQL
    console.log(`[RUNTIME] Starting PostgreSQL on port ${port}...`);
    try {
      // Clean stale lock files from previous crash
      const pidFile = path.join(PG_DATA, 'postmaster.pid');
      if (fs.existsSync(pidFile)) {
        console.log('[RUNTIME] Removing stale PostgreSQL PID file...');
        fs.unlinkSync(pidFile);
      }

      execSync(`"${pgCtl}" start -D "${PG_DATA}" -l "${path.join(LOGS_DIR, 'postgres.log')}" -o "-p ${port} -h 127.0.0.1" -w`, {
        stdio: 'pipe', timeout: 30000, env: pgEnv
      });
    } catch (e) {
      console.error('[RUNTIME] PostgreSQL start failed:', e.message);
      // Try reading the log for details
      try {
        const log = fs.readFileSync(path.join(LOGS_DIR, 'postgres.log'), 'utf-8');
        const lastLines = log.split('\n').slice(-5).join('\n');
        console.error('[RUNTIME] PG log:', lastLines);
      } catch {}
      return false;
    }

    // Wait for readiness
    const ready = await this.waitForPort(port, 15);
    if (ready) {
      this.services.postgres = { port, pid: null, state: 'healthy' };
      console.log(`[RUNTIME] PostgreSQL HEALTHY on port ${port}`);

      // Create kayo database if it doesn't exist
      try {
        const psql = path.join(pgBin, 'psql.exe');
        execSync(`"${psql}" -h 127.0.0.1 -p ${port} -U kayo -d postgres -c "SELECT 1 FROM pg_database WHERE datname='kayo'" -t`, { stdio: 'pipe' });
        // Check if database exists
        const result = execSync(`"${psql}" -h 127.0.0.1 -p ${port} -U kayo -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='kayo'"`, { encoding: 'utf-8' });
        if (!result.trim()) {
          execSync(`"${psql}" -h 127.0.0.1 -p ${port} -U kayo -d postgres -c "CREATE DATABASE kayo"`, { stdio: 'pipe' });
          console.log('[RUNTIME] Created kayo database');
        }
      } catch (e) {
        // Database might already exist
      }

      return true;
    }
    return false;
  }

  stopPostgres() {
    if (!this.services.postgres) return;
    const pgBin = path.join(this.resourcesPath, 'runtime', 'postgres', 'bin');
    const pgCtl = path.join(pgBin, 'pg_ctl.exe');
    try {
      execSync(`"${pgCtl}" stop -D "${PG_DATA}" -m fast`, { stdio: 'pipe', timeout: 10000 });
      console.log('[RUNTIME] PostgreSQL stopped');
    } catch (e) {
      console.warn('[RUNTIME] PostgreSQL stop warning:', e.message);
    }
    this.services.postgres = null;
  }

  // ── Redis ───────────────────────────────────────────────────────────────

  async startRedis() {
    const redisBin = path.join(this.resourcesPath, 'runtime', 'redis', 'redis-server.exe');

    if (!fs.existsSync(redisBin)) {
      console.error('[RUNTIME] Redis binary not found at:', redisBin);
      return false;
    }

    const port = await this.findAvailablePort(6379);
    console.log(`[RUNTIME] Starting Redis on port ${port}...`);

    const proc = spawn(redisBin, ['--port', String(port), '--bind', '127.0.0.1', '--dir', REDIS_DATA], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const logStream = fs.createWriteStream(path.join(LOGS_DIR, 'redis.log'), { flags: 'a' });
    proc.stdout.pipe(logStream);
    proc.stderr.pipe(logStream);

    proc.on('exit', (code) => {
      console.log('[RUNTIME] Redis exited:', code);
      if (this.services.redis) this.services.redis.state = 'stopped';
    });

    // Wait for readiness
    const ready = await this.waitForPort(port, 10);
    if (ready) {
      this.services.redis = { port, proc, state: 'healthy' };
      console.log(`[RUNTIME] Redis HEALTHY on port ${port}`);
      return true;
    }

    proc.kill();
    return false;
  }

  stopRedis() {
    if (this.services.redis && this.services.redis.proc) {
      this.services.redis.proc.kill();
      console.log('[RUNTIME] Redis stopped');
    }
    this.services.redis = null;
  }

  // ── Assessment Engine ───────────────────────────────────────────────────

  async startAssessment() {
    const serverJs = path.join(this.resourcesPath, 'assessment', 'dist', 'server.js');
    
    // Fallback: check if it's in the web/assessment path
    const altPath = path.join(this.resourcesPath, 'web', '..', 'assessment', 'dist', 'server.js');
    const actualPath = fs.existsSync(serverJs) ? serverJs : altPath;

    if (!fs.existsSync(actualPath)) {
      console.warn('[RUNTIME] Assessment Engine not bundled, skipping');
      this.services.assessment = { port: null, state: 'unavailable' };
      return true; // Non-blocking for Tier 1
    }

    const port = 3100;
    console.log(`[RUNTIME] Starting Assessment Engine on port ${port}...`);

    const proc = fork(actualPath, [], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', KAYO_SERVICE_TOKEN: 'kayo-local-token' },
      silent: true,
    });

    const logStream = fs.createWriteStream(path.join(LOGS_DIR, 'assessment.log'), { flags: 'a' });
    proc.stdout.pipe(logStream);
    proc.stderr.pipe(logStream);

    proc.on('exit', (code) => {
      console.log('[RUNTIME] Assessment Engine exited:', code);
    });

    const ready = await this.checkHttpRetry(port, '/health', 10);
    if (ready) {
      this.services.assessment = { port, proc, state: 'healthy' };
      console.log(`[RUNTIME] Assessment Engine HEALTHY on port ${port}`);
      return true;
    }

    this.services.assessment = { port, proc, state: 'degraded' };
    return true; // Non-fatal
  }

  stopAssessment() {
    if (this.services.assessment && this.services.assessment.proc) {
      this.services.assessment.proc.kill();
    }
    this.services.assessment = null;
  }

  async checkHttpRetry(port, path, attempts) {
    for (let i = 0; i < attempts; i++) {
      const ok = await this.checkHttp(port, path);
      if (ok) return true;
      await new Promise(r => setTimeout(r, 1000));
    }
    return false;
  }

  // ── Control Plane ───────────────────────────────────────────────────────

  async startControlPlane() {
    const backendExe = path.join(this.resourcesPath, 'backend', 'kayo-backend.exe');

    if (!fs.existsSync(backendExe)) {
      console.error('[RUNTIME] Control Plane executable not found');
      return false;
    }

    const pgPort = this.services.postgres ? this.services.postgres.port : 5432;
    const redisPort = this.services.redis ? this.services.redis.port : 6379;
    const assessmentPort = this.services.assessment ? this.services.assessment.port : 3100;

    console.log('[RUNTIME] Starting Control Plane...');

    const proc = spawn(backendExe, [], {
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://kayo:@127.0.0.1:${pgPort}/kayo`,
        REDIS_URL: `redis://127.0.0.1:${redisPort}/0`,
        SECRET_KEY: 'kayo-desktop-secret-key',
        KAFKA_BOOTSTRAP_SERVERS: 'localhost:9092',
        NEO4J_URI: 'bolt://localhost:7687',
        NEO4J_USER: 'neo4j',
        NEO4J_PASSWORD: 'kayo',
        CLICKHOUSE_PORT: '9000',
        ASSESSMENT_ENGINE_URL: `http://127.0.0.1:${assessmentPort}`,
        SERVICE_TOKEN: 'kayo-local-token',
        KAYO_MODE: 'desktop',
        DEBUG: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const logStream = fs.createWriteStream(path.join(LOGS_DIR, 'control-plane.log'), { flags: 'a' });
    proc.stdout.pipe(logStream);
    proc.stderr.pipe(logStream);
    // Also echo to console
    proc.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line.includes('Application startup complete') || line.includes('Uvicorn running')) {
        console.log('[CP]', line);
      }
    });

    proc.on('exit', (code) => {
      console.log('[RUNTIME] Control Plane exited:', code);
      if (this.services.controlPlane) this.services.controlPlane.state = 'stopped';
    });

    const ready = await this.checkHttpRetry(8000, '/health', 20);
    if (ready) {
      this.services.controlPlane = { port: 8000, proc, state: 'healthy' };
      console.log('[RUNTIME] Control Plane HEALTHY');
      return true;
    }

    proc.kill();
    return false;
  }

  stopControlPlane() {
    if (this.services.controlPlane && this.services.controlPlane.proc) {
      this.services.controlPlane.proc.kill();
    }
    this.services.controlPlane = null;
  }

  // ── Orchestration ───────────────────────────────────────────────────────

  async startAll(progressCallback) {
    this.state = 'starting';
    const report = (msg) => {
      console.log(msg);
      if (progressCallback) progressCallback(msg);
    };

    report('[RUNTIME] Starting KAYO Security Runtime...');

    // 1. PostgreSQL
    report('[RUNTIME] Starting PostgreSQL...');
    const pgOk = await this.startPostgres();
    if (!pgOk) {
      this.state = 'critical';
      report('[RUNTIME] CRITICAL: PostgreSQL failed');
      return false;
    }

    // 2. Redis
    report('[RUNTIME] Starting Redis...');
    const redisOk = await this.startRedis();
    if (!redisOk) {
      this.state = 'degraded';
      report('[RUNTIME] WARNING: Redis failed (degraded mode)');
      // Continue — Control Plane may work with limited caching
    }

    // 3. Assessment Engine (non-blocking)
    report('[RUNTIME] Starting Assessment Engine...');
    await this.startAssessment();

    // 4. Control Plane
    report('[RUNTIME] Starting Control Plane...');
    const cpOk = await this.startControlPlane();
    if (!cpOk) {
      this.state = 'critical';
      report('[RUNTIME] CRITICAL: Control Plane failed');
      return false;
    }

    this.state = 'ready';
    report('[RUNTIME] ✓ KAYO Runtime READY');
    return true;
  }

  async stopAll() {
    console.log('[RUNTIME] Shutting down KAYO Runtime...');
    this.stopControlPlane();
    this.stopAssessment();
    this.stopRedis();
    this.stopPostgres();
    this.state = 'stopped';
    console.log('[RUNTIME] Runtime stopped');
  }

  getStatus() {
    return {
      state: this.state,
      services: {
        postgres: this.services.postgres ? this.services.postgres.state : 'stopped',
        redis: this.services.redis ? this.services.redis.state : 'stopped',
        assessment: this.services.assessment ? this.services.assessment.state : 'stopped',
        controlPlane: this.services.controlPlane ? this.services.controlPlane.state : 'stopped',
      },
      ports: {
        postgres: this.services.postgres ? this.services.postgres.port : null,
        redis: this.services.redis ? this.services.redis.port : null,
        assessment: this.services.assessment ? this.services.assessment.port : null,
        controlPlane: this.services.controlPlane ? this.services.controlPlane.port : null,
      },
      dataDir: DATA_DIR,
    };
  }
}

module.exports = { RuntimeManager, DATA_DIR, LOGS_DIR };

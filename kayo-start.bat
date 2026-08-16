@echo off
title KAYO Launcher
echo.
echo  ██╗  ██╗ █████╗ ██╗   ██╗ ██████╗
echo  ██║ ██╔╝██╔══██╗╚██╗ ██╔╝██╔═══██╗
echo  █████╔╝ ███████║ ╚████╔╝ ██║   ██║
echo  ██╔═██╗ ██╔══██║  ╚██╔╝  ██║   ██║
echo  ██║  ██╗██║  ██║   ██║   ╚██████╔╝
echo  ╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝    ╚═════╝
echo.
echo  Security Lifecycle Platform
echo  ─────────────────────────────────────
echo.

:: Set environment variables for backend
set DATABASE_URL=postgresql://kayo:kayo_e2e_password@localhost:5433/kayo_e2e
set REDIS_URL=redis://localhost:6379/0
set SECRET_KEY=kayo-e2e-test-secret
set KAFKA_BOOTSTRAP_SERVERS=localhost:9092
set NEO4J_URI=bolt://localhost:7687
set NEO4J_USER=neo4j
set NEO4J_PASSWORD=kayo_e2e_password
set CLICKHOUSE_HOST=localhost
set CLICKHOUSE_PORT=9001
set CLICKHOUSE_DATABASE=kayo_events
set CLICKHOUSE_USER=kayo
set CLICKHOUSE_PASSWORD=kayo_e2e_password
set ASSESSMENT_ENGINE_URL=http://localhost:3100
set MONITOR_SERVICE_URL=http://localhost:8002
set SERVICE_TOKEN=kayo-e2e-service-token
set DEBUG=true
set NEXT_PUBLIC_API_URL=http://localhost:8000

:: Check Docker
echo [1/4] Checking Docker infrastructure...
docker ps >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Docker is not running. Start Docker Desktop first.
    echo  [!] Then run: docker compose -f docker-compose.e2e.yml up -d
    pause
    exit /b 1
)

:: Start Docker infra if not running
docker ps --format "{{.Names}}" | findstr "kayo-e2e-postgres" >nul 2>&1
if %errorlevel% neq 0 (
    echo  [*] Starting Docker infrastructure...
    docker compose -f docker-compose.e2e.yml up -d postgres redis kafka zookeeper neo4j clickhouse
    echo  [*] Waiting for services...
    timeout /t 10 /nobreak >nul
) else (
    echo  [OK] Docker infrastructure already running
)

:: Start Backend
echo.
echo [2/4] Starting KAYO Control Plane (port 8000)...
start "KAYO Backend" cmd /k "title KAYO Backend & cd /d %~dp0services\control-plane & color 0C & echo KAYO Control Plane starting... & python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

timeout /t 5 /nobreak >nul

:: Start Frontend
echo [3/4] Starting KAYO Frontend (port 3000)...
start "KAYO Frontend" cmd /k "title KAYO Frontend & cd /d %~dp0apps\web & color 0B & echo KAYO Frontend starting... & npx next dev"

timeout /t 5 /nobreak >nul

:: Start Electron
echo [4/4] Starting KAYO Desktop...
start "KAYO Desktop" cmd /k "title KAYO Desktop & cd /d %~dp0apps\desktop & color 0E & echo KAYO Desktop starting... & set KAYO_MODE=development & npx electron ."

echo.
echo  ─────────────────────────────────────
echo  KAYO is starting!
echo.
echo  Backend:   http://localhost:8000
echo  Frontend:  http://localhost:3000
echo  Desktop:   Electron window
echo.
echo  Login:     test@kayo-e2e.io / TestPassword123!
echo  ─────────────────────────────────────
echo.
echo  Press any key to exit this launcher...
echo  (Services will continue running in their windows)
pause >nul

# KAYO — Setup Guide

Get the KAYO platform running locally for development in 5 minutes.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 18+ | Frontend + Assessment Engine |
| **Python** | 3.11+ | Control Plane + Backend Services |
| **Docker Desktop** | Latest | Infrastructure (PostgreSQL, Redis, Kafka, Neo4j, ClickHouse) |
| **Git** | Latest | Version control |

Optional:
- **Electron** (installed via npm) — Desktop app development
- **AWS CLI** — For deployment engine testing

---

## Quick Start (Development)

### 1. Clone the repository

```bash
git clone https://github.com/Jayom5797/KAYO-Electron.git
cd KAYO-Electron
```

### 2. Start infrastructure (Docker)

```bash
docker compose up -d
```

This starts: PostgreSQL (port 5433), Redis (6379), Kafka (9092), ClickHouse (8123/9001), Neo4j (7474/7687)

Wait ~30 seconds for all services to be healthy:
```bash
docker compose ps
```

### 3. Set up the Control Plane (Backend API)

```bash
cd services/control-plane

# Create virtual environment
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy environment config
copy ..\..\env.example .env
# OR on macOS/Linux:
cp ../../.env.example .env

# Run database migrations
alembic upgrade head

# Start the API server
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Backend is now at: **http://localhost:8000**  
Health check: http://localhost:8000/health  
API docs: http://localhost:8000/docs

### 4. Set up the Frontend (Next.js)

Open a new terminal:

```bash
cd apps/web

# Install dependencies
npm install

# Copy environment
copy .env.example .env
# OR:
cp .env.example .env

# Start dev server
npm run dev
```

Frontend is now at: **http://localhost:3000**

### 5. Set up the Assessment Engine (optional)

Open another terminal:

```bash
cd services/assessment-engine

# Install dependencies
npm install

# Install Playwright browsers (for URL scanning)
npx playwright install chromium

# Start
npm start
```

Assessment Engine runs at: **http://localhost:4000**

---

## Running the Desktop App (Electron)

```bash
cd apps/desktop

# Install Electron dependencies
npm install

# Run in dev mode (connects to localhost:3000 + localhost:8000)
npm run dev
```

> The Electron shell wraps the Next.js frontend and communicates with the local Control Plane.

---

## One-Command Launch (Windows)

If you have all services installed, use the batch launcher:

```bash
kayo-start.bat
```

This opens 3 color-coded terminal windows:
- 🔴 Backend (Control Plane on port 8000)
- 🔵 Frontend (Next.js on port 3000)
- 🟡 Electron (Desktop shell)

To stop everything:
```bash
kayo-stop.bat
```

---

## Default Credentials

After running the backend for the first time, create a user:

```bash
# Using the signup API directly:
curl -X POST http://localhost:8000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@kayo.local", "password": "YourPassword123!"}'
```

Or sign up through the UI at http://localhost:3000.

---

## Project Structure

```
KAYO-Electron/
├── apps/
│   ├── web/                     # Next.js frontend (React + Tailwind)
│   └── desktop/                 # Electron shell + splash screen
├── services/
│   ├── control-plane/           # FastAPI backend (auth, projects, scans, incidents)
│   ├── assessment-engine/       # Node.js URL/repo security scanner
│   ├── deployment-engine/       # AWS auto-deployment pipeline
│   ├── monitor-service/         # Uptime + resilience monitoring
│   ├── detection-engine/        # MITRE ATT&CK threat detection
│   ├── graph-engine/            # Neo4j behavior graph builder
│   ├── telemetry-ingestion/     # Kafka → ClickHouse pipeline
│   └── ai-service/              # LLM provider abstraction
├── packages/
│   ├── shared-schemas/          # Canonical data models
│   ├── security-rules/          # YAML detection rules
│   └── deployment-templates/    # Stack templates
├── infrastructure/              # Terraform, K8s, ClickHouse schemas
├── tests/                       # e2e, integration, unit tests
├── docker-compose.yml           # Full infrastructure stack
├── kayo-start.bat               # Windows one-command launcher
└── SETUP.md                     # ← You are here
```

---

## Environment Variables

Copy `.env.example` to `.env` in the project root. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://kayo:kayo_dev_password@localhost:5433/kayo_control_plane` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis cache |
| `KAFKA_BOOTSTRAP_SERVERS` | `localhost:9092` | Kafka broker |
| `NEO4J_URI` | `bolt://localhost:7687` | Neo4j graph database |
| `SECRET_KEY` | `kayo-dev-secret-key...` | JWT signing key |
| `OPENAI_API_KEY` | (empty) | Optional: AI analysis |
| `AWS_ACCESS_KEY_ID` | (empty) | Optional: deployment engine |

---

## Common Commands

```bash
# Infrastructure
docker compose up -d              # Start all infra
docker compose down               # Stop all infra
docker compose logs -f kafka      # Tail specific service logs

# Backend
cd services/control-plane
uvicorn main:app --reload         # Dev server with hot reload
alembic upgrade head              # Run migrations
alembic revision --autogenerate -m "description"  # New migration
pytest                            # Run tests

# Frontend
cd apps/web
npm run dev                       # Dev server (port 3000)
npm run build                     # Production build
npm run lint                      # ESLint check
npm run type-check                # TypeScript check

# Desktop
cd apps/desktop
npm run dev                       # Electron dev mode
npm run build                     # Package for distribution

# Tests
cd tests
pytest e2e/                       # End-to-end tests
pytest integration/               # Integration tests
```

---

## Troubleshooting

### Port conflicts
If ports 5433, 6379, 8000, or 3000 are in use, check for existing processes:
```bash
# Windows
netstat -ano | findstr :8000

# macOS/Linux  
lsof -i :8000
```

### Docker not starting
Ensure Docker Desktop is running. On Windows, enable WSL 2 integration.

### Database connection errors
Wait for PostgreSQL container to be healthy before starting the backend:
```bash
docker compose ps  # Check all show "healthy"
```

### Frontend can't reach backend
Verify `apps/web/.env` has `NEXT_PUBLIC_API_URL=http://localhost:8000` and the backend is running.

### Playwright not working
Assessment engine needs browser binaries:
```bash
cd services/assessment-engine
npx playwright install chromium
```

---

## Building for Production

### Desktop Installer (Windows)

```bash
cd apps/desktop

# Step 1: Package (creates dist/win-unpacked/)
npx electron-builder --win --dir

# Step 2: Create NSIS installer
npx electron-builder --win nsis --prepackaged dist\win-unpacked
```

Output: `apps/desktop/dist/KAYO Setup 1.0.0.exe`

### Docker Deployment

```bash
docker compose -f docker-compose.yml up -d --build
```

---

## Contributing

1. Create a feature branch from `main`
2. Make changes
3. Run `npm run lint` and `pytest` to verify
4. Push and create a Pull Request

---

## License

Copyright © 2026 KAYO Security. All rights reserved.

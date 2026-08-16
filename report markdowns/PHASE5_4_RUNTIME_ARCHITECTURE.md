# KAYO Phase 5.4 — Self-Contained Desktop Runtime Architecture

**Date**: August 16, 2026  
**Status**: ARCHITECTURE DESIGNED — Implementation ready

---

## 1. Chosen Strategy: Portable Native Windows Binaries

**Decision**: Bundle portable Windows binaries for each service directly into the KAYO installer. No Docker, no WSL, no VM.

**Rationale**:
- Portable PostgreSQL exists for Windows (extract + `initdb` + `pg_ctl start`) — ~30MB
- Redis has Windows ports (Memurai or MSOpenTech fork) — ~5MB
- Kafka runs on JVM (bundle a minimal JRE + Kafka binaries) — ~150MB
- Neo4j has an embeddable JVM mode — ~100MB
- ClickHouse has Windows builds — ~100MB
- Total additional: ~400-500MB (compressed: ~150-200MB)

**Why not Docker**: Requires Docker Desktop installation (2+ GB, admin, WSL2 on Win10). Violates "user installs only KAYO."

**Why not SQLite replacement**: Would require rewriting the entire backend (Kafka topics, Neo4j graph queries, ClickHouse columnar analytics). Breaks proven architecture.

---

## 2. Service-by-Service Packaging Plan

| Service | Packaging Strategy | Windows Binary Source | Size |
|---------|-------------------|---------------------|------|
| **PostgreSQL** | Portable binaries (no installer) | [postgresql-portable](https://github.com/garethflowers/postgresql-portable) or official zip | ~30 MB |
| **Redis** | Windows port binary | Memurai or [redis-windows](https://github.com/ServiceStack/redis-windows) | ~5 MB |
| **Kafka + Zookeeper** | Portable JVM + Kafka scripts | Apache Kafka binary + bundled JRE 17 | ~150 MB |
| **Neo4j** | Community edition portable | Neo4j Community (Java-based) | ~100 MB |
| **ClickHouse** | Windows native binary | ClickHouse Windows build | ~100 MB |
| **Assessment Engine** | Node.js + Playwright (Electron's Node) | Already packaged | ~120 MB |

**Total installer size estimate**: ~600-800 MB (compressed NSIS)

---

## 3. Runtime Manager Design

```
KAYO Desktop
│
├── Electron Shell
├── kayo-backend.exe (Control Plane)
├── Next.js Standalone (UI)
│
└── Runtime Manager
    ├── PostgreSQL Manager
    │   ├── bin/postgres.exe, pg_ctl.exe, initdb.exe
    │   └── data/ (user data directory)
    ├── Redis Manager
    │   └── bin/redis-server.exe
    ├── Kafka Manager
    │   ├── jre/ (bundled Java)
    │   ├── kafka/ (Kafka + Zookeeper)
    │   └── data/
    ├── Neo4j Manager
    │   ├── jre/ (shared with Kafka)
    │   ├── neo4j/ (community)
    │   └── data/
    ├── ClickHouse Manager
    │   ├── bin/clickhouse.exe
    │   └── data/
    └── Assessment Engine Manager
        └── (uses Electron's Node + bundled Playwright)
```

---

## 4. Startup Sequence

```
KAYO.exe launched
  │
  ├── Runtime Manager initializes
  │   ├── Detect first-run (no data dir)
  │   │   └── Initialize databases (initdb, create schemas)
  │   │
  │   ├── Start PostgreSQL    → wait for port 5432
  │   ├── Start Redis         → wait for port 6379
  │   ├── Start Zookeeper     → wait for port 2181
  │   ├── Start Kafka         → wait for port 9092
  │   ├── Start Neo4j         → wait for port 7687
  │   ├── Start ClickHouse    → wait for port 9000
  │   │
  │   ├── All infrastructure healthy ✓
  │   │
  │   ├── Start Assessment Engine → wait for port 3100
  │   ├── Start Control Plane     → wait for port 8000
  │   │
  │   └── KAYO RUNTIME READY
  │
  ├── Start Next.js UI → dynamic port
  ├── Open BrowserWindow
  └── KAYO DESKTOP READY
```

---

## 5. Data Persistence

```
%LOCALAPPDATA%\KAYO\
├── runtime/
│   ├── postgres/data/      (database files)
│   ├── redis/              (RDB/AOF)
│   ├── kafka/logs/         (topic data)
│   ├── zookeeper/data/     (ZK data)
│   ├── neo4j/data/         (graph database)
│   └── clickhouse/data/    (columnar data)
├── logs/
│   ├── postgres.log
│   ├── redis.log
│   ├── kafka.log
│   ├── neo4j.log
│   ├── clickhouse.log
│   ├── backend.log
│   └── assessment.log
└── config/
    └── runtime.json        (ports, paths, state)
```

---

## 6. Service Classification

| Service | Classification | Reason |
|---------|---------------|--------|
| PostgreSQL | **REQUIRED** | Primary data store (tenants, users, scans, findings, incidents) |
| Redis | **REQUIRED** | Rate limiting, caching, session management |
| Kafka | **REQUIRED for Angle 1** | Event streaming for runtime detection |
| Zookeeper | **REQUIRED for Kafka** | Kafka coordination |
| Neo4j | **REQUIRED for Angle 1** | Behavior graph for MITRE detection |
| ClickHouse | **OPTIONAL (degraded)** | Analytics/telemetry storage; can operate without |
| Assessment Engine | **REQUIRED for Angle 2** | URL/repo security scanning |
| Control Plane | **REQUIRED** | API gateway for all operations |

---

## 7. Graceful Degradation

| Scenario | KAYO State | Available |
|----------|-----------|-----------|
| All services healthy | READY | All 3 angles |
| ClickHouse down | DEGRADED | Angles 2+3, partial Angle 1 |
| Kafka/Neo4j down | DEGRADED | Angle 2+3, no runtime detection |
| Assessment Engine down | DEGRADED | Angle 1+3, no URL scanning |
| PostgreSQL down | CRITICAL | Nothing works |
| Redis down | DEGRADED | Slower, no rate limiting |

---

## 8. Security Model

- All services bind to `127.0.0.1` only
- PostgreSQL uses local socket/password auth
- Redis requires no external access
- Kafka listeners are localhost-only
- Neo4j uses local authentication
- No service exposed to LAN/public by default

---

## 9. Resource Estimates

| State | RAM | CPU | Disk |
|-------|-----|-----|------|
| Idle (all services running) | ~2-3 GB | Minimal | ~500 MB + data |
| Active scanning | +500 MB (Playwright) | Moderate | Growing |
| Active detection | +200 MB (Kafka consumers) | Low-moderate | Growing |

**Minimum recommended**: 8 GB RAM, 2 GB free disk

---

## 10. Upgrade Strategy

- Application update: Replace KAYO binaries, preserve `%LOCALAPPDATA%\KAYO\runtime/` data
- Service version update: Stop service, replace binaries, run migration if needed, restart
- Never delete user data on application update

---

## 11. Uninstall Behavior

- **Uninstall KAYO**: Remove application files only. Data preserved in `%LOCALAPPDATA%\KAYO\`
- **Full cleanup** (optional): User can delete `%LOCALAPPDATA%\KAYO\` manually or via provided cleanup tool

---

## 12. Implementation Priority

```
Phase 1: PostgreSQL + Redis (enables Control Plane)
Phase 2: Assessment Engine (enables Angle 2)
Phase 3: Kafka + Zookeeper + Neo4j (enables Angle 1)
Phase 4: ClickHouse (enables full telemetry)
```

Phases 1-2 provide a usable product (Angles 2+3).
Phases 3-4 add full runtime detection.

---

## 13. Known Limitations

1. **Installer size**: ~600-800 MB (all services + JRE)
2. **RAM usage**: ~2-3 GB when all services run
3. **First-run time**: 10-30 seconds for database initialization
4. **JRE bundling**: Kafka + Neo4j both need Java (shared JRE ~180MB)
5. **Windows-only**: Portable binaries are platform-specific
6. **No clustering**: Single-node, single-user security workstation

---

## 14. Comparison with Alternatives

| Approach | Install Complexity | Disk | RAM | Proven Architecture? |
|----------|-------------------|------|-----|---------------------|
| **Portable binaries (chosen)** | Low (NSIS installer) | 800MB | 2-3GB | ✅ Yes |
| Docker bundled | Medium (Docker Desktop) | 2GB+ | 3-4GB | ✅ Yes |
| SQLite replacement | Low | 300MB | 500MB | ❌ No (rewrite required) |
| Cloud-hosted backend | Low (thin client) | 200MB | 200MB | ✅ Yes (but not self-contained) |
| WSL2 embedded | High (WSL install) | 2GB+ | 3-4GB | ✅ Yes |

---

## 15. AWS Separation (Unchanged)

```
LOCAL (KAYO Desktop):           REMOTE (User Projects):
├── PostgreSQL (KAYO data)      ├── Project A → AWS ECS
├── Redis (caching)             ├── Project B → AWS ECS  
├── Kafka (events)              └── Project C → AWS ECS
├── Neo4j (graphs)
├── ClickHouse (telemetry)
├── Assessment Engine
└── Control Plane
```

User projects are NEVER hosted locally. Only KAYO's own infrastructure runs locally.

---

PHASE 5.4 COMPLETE — AWAITING REVIEW

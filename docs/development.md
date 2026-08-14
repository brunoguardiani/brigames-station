# Development Guide

## Overview

brigames-station is a private desktop communication application for a small group of
users, with approximately 15 concurrent users. It is developed as a monorepo
containing the desktop application, Go backend, shared HTTP contracts,
infrastructure, and documentation.

The repository uses pnpm workspaces for TypeScript packages. During local
development, Go, Angular, and Electron run on the host machine. PostgreSQL runs
through Docker Compose.

## Initial Repository Structure

```text
brigames-station/
├── apps/
│   ├── desktop/
│   │   ├── electron/          # Electron main process and preload
│   │   └── src/               # Angular renderer
│   └── server/
│       ├── cmd/api/           # Backend entrypoint
│       ├── internal/
│       │   ├── config/
│       │   ├── database/
│       │   ├── health/
│       │   ├── http/
│       │   └── observability/
│       └── migrations/        # Versioned SQL migrations
├── packages/
│   └── protocol/
│       └── openapi/           # HTTP contract source of truth
├── infra/
│   ├── compose/
│   └── postgres/
├── docs/
├── .env.example
├── .gitignore
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

Directories for business domains must be added only when the corresponding
phase introduces them. Phase 0 must not create empty implementations for
users, servers, channels, messages, authentication, or realtime features.

## Backend Conventions

- Use Go's `net/http` with a lightweight router.
- Use `pgx` for PostgreSQL connectivity.
- Keep database migrations as ordered, versioned SQL files.
- Keep application code under `apps/server/internal` unless it is intended for
  external reuse.
- Configure structured logging and graceful shutdown from the initial backend
  entrypoint.

The backend provides two operational endpoints:

- `GET /health` is a liveness endpoint and must not query PostgreSQL.
- `GET /ready` is a readiness endpoint and must verify PostgreSQL connectivity.

## HTTP Contracts

OpenAPI is the source of truth for HTTP contracts. The specification resides in
`packages/protocol/openapi`. The backend implementation and desktop client must
conform to the published contract.

## Desktop Security

The desktop application uses Electron with Angular and TypeScript. Electron
must run with `contextIsolation=true` and `nodeIntegration=false`. The preload
must expose only a minimal, explicitly typed IPC surface required by the
renderer.

## Configuration and Local Infrastructure

- Commit `.env.example`, never actual secrets.
- Validate required configuration on process startup.
- Use Docker Compose for the local PostgreSQL service and its persistent volume.
- Run migrations through an explicit, repeatable command or service; starting
  the API must not silently apply unreviewed schema changes.

## Phase 0 Boundaries

The following are intentionally outside Phase 0: authentication, authorization,
WebSocket, presence, LiveKit, WebRTC, Redis, and all business-domain features.

# Development Guide

## Overview

brigames-station is a private Electron, Angular, Go, and PostgreSQL application
for a small group. TypeScript packages use pnpm workspaces. During local
development PostgreSQL runs with Docker Compose; Go, Angular, and Electron run
on the host.

## Repository Structure

```text
brigames-station/
|- apps/
|  |- desktop/
|  |  |- electron/       # Electron main process and narrow preload boundary
|  |  `- src/            # Angular renderer
|  `- server/
|     |- cmd/             # api, migrate, and seed-owner commands
|     |- internal/
|     |  |- auth/         # Password hashing and JWT/refresh-token support
|     |  |- identity/     # Accounts and sessions
|     |  |- servers/      # Servers, memberships, channels, authorization
|     |  |- http/         # Gin routing and handlers
|     |  `- migrations/   # Migration runner
|     `- migrations/      # Ordered SQL and reverse SQL migrations
|- packages/protocol/
|  |- openapi/            # Source-of-truth HTTP contract
|  `- postman/            # Manual API collection
|- infra/                 # Local infrastructure support
`- docs/
```

## Backend Conventions

- Gin provides routing and middleware on Go's standard `net/http` stack.
- PostgreSQL access uses `pgx`; all user-provided SQL values use parameters.
- Migrations are paired, ordered SQL files. Run them explicitly; the API never
  applies schema changes at startup.
- OpenAPI in `packages/protocol/openapi` is the source of truth for HTTP.
- `GET /health` is liveness and never queries PostgreSQL; `GET /ready` checks
  PostgreSQL readiness.

## Desktop Security

Electron runs with `contextIsolation=true`, `nodeIntegration=false`, and a
minimal typed preload API. The Electron main process owns access and refresh
tokens. Angular receives domain data only and never receives raw tokens or
Node APIs.

## Local Configuration

- Commit `.env.example`, never `.env` or secrets.
- Load `.env` values into each terminal that runs a Go command; Go does not
  load `.env` files automatically.
- PostgreSQL uses Docker Compose and a persistent local volume.

## Current Phase Boundaries

Phase 2 provides authenticated servers, memberships, and text channels. It
does not provide messages, invitations, server deletion, WebSocket, presence,
notifications, LiveKit, WebRTC, or other media features.

# Roadmap

## Roadmap Principles

The roadmap is organized by functional milestones rather than fixed dates. A
milestone is complete only when its acceptance criteria are met. Implement
features incrementally and do not introduce future-phase infrastructure without
a concrete requirement.

## Phase 0 — Project Foundation

### Objective

Create a repeatable local development environment and demonstrate the minimum
end-to-end path from the desktop application to the Go backend and PostgreSQL.

### Approved Scope

- brigames-station is a pnpm-workspace monorepo.
- PostgreSQL runs through Docker Compose.
- Go, Angular, and Electron run locally during development.
- HTTP contracts use OpenAPI as their source of truth.
- The backend uses Gin and `pgx`.
- Migrations are versioned SQL files.
- Electron uses `contextIsolation=true`, `nodeIntegration=false`, and a minimal
  preload API.

### Explicitly Out of Scope

- Authentication and authorization.
- WebSocket, presence, and automatic reconnection.
- LiveKit, WebRTC, voice, video, and screen sharing.
- Redis.
- Users, profiles, servers, memberships, channels, messages, and permissions.
- Notifications and system tray integration.

### Tasks

#### Repository and Documentation

- [x] Create the approved monorepo structure.
- [x] Configure pnpm workspaces.
- [x] Configure `.gitignore`.
- [x] Create `.env.example`.
- [x] Add the initial OpenAPI contract for operational endpoints.
- [x] Keep project documentation aligned with the approved architecture.

#### Infrastructure and Database

- [x] Create Docker Compose configuration for PostgreSQL.
- [x] Configure persistent local database storage.
- [x] Configure environment variables for local PostgreSQL access.
- [x] Initialize versioned SQL migration infrastructure.
- [x] Configure `pgx` database connectivity in the backend.

#### Backend

- [x] Initialize the Go module and backend entrypoint.
- [x] Create validated configuration loading.
- [x] Create the HTTP server using Gin.
- [x] Implement structured logging.
- [x] Implement graceful shutdown.
- [x] Implement `GET /health` as a liveness endpoint independent of PostgreSQL.
- [x] Implement `GET /ready` as a PostgreSQL readiness endpoint.

#### Desktop

- [x] Initialize the Angular application.
- [x] Initialize Electron and integrate it with Angular development and build.
- [x] Create the initial application window.
- [x] Establish the secure preload boundary.
- [x] Query the backend operational endpoint from the desktop application.
- [x] Display loading, available, and unavailable backend states.

#### Verification

- [x] Document local startup and verification steps.
- [x] Validate the complete desktop-to-backend-to-PostgreSQL path.

### Required Implementation Order

1. Create the repository structure, workspace configuration, ignore rules, and
   environment example.
2. Add the OpenAPI definition for `GET /health` and `GET /ready`.
3. Configure Docker Compose and PostgreSQL.
4. Initialize the Go module, configuration, structured logging, and graceful
   shutdown.
5. Configure `pgx` and the versioned SQL migration infrastructure.
6. Implement the HTTP server, liveness endpoint, and readiness endpoint.
7. Initialize Angular and Electron, including the secure preload boundary.
8. Implement the desktop health-status view against the approved HTTP contract.
9. Verify the acceptance criteria and document the local workflow.

### Acceptance Criteria

- PostgreSQL starts through Docker Compose with persistent local storage.
- Versioned SQL migrations can be applied repeatably to an empty database.
- The backend starts with validated configuration, structured logs, and graceful
  shutdown.
- `GET /health` succeeds while the HTTP process is alive, even if PostgreSQL is
  unavailable.
- `GET /ready` succeeds only when PostgreSQL connectivity is available.
- Electron opens an Angular window with context isolation enabled and Node
  integration disabled.
- The desktop application displays the backend availability state.
- No secrets are committed; all required variables are documented in
  `.env.example`.

## Phase 1 — Identity and Access (Proposed)

The proposed Phase 1 plan is documented in
[`phase-1-identity.md`](./phase-1-identity.md). Implementation must not start
until its registration, identity, session-duration, and first-account policies
are approved.

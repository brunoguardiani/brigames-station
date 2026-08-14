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

## Phase 1 — Identity and Access

Phase 1 is complete. Its approved design and implementation detail are
documented in [`phase-1-identity.md`](./phase-1-identity.md).

### Delivered Scope

- [x] Add OpenAPI contracts for registration, login, refresh, logout, and
  current-user operations.
- [x] Add versioned SQL migrations for global roles, users, and refresh tokens.
- [x] Add secure first-owner bootstrap through `cmd/seed-owner`; no
  credential is stored in migrations or source control.
- [x] Add Argon2id password hashing, JWT access tokens, opaque hashed refresh
  tokens, refresh-token rotation, and logout revocation.
- [x] Add authentication middleware and the protected `GET /me` endpoint.
- [x] Add desktop login, secure encrypted refresh-token storage in the
  Electron main process, session restoration, and logout.
- [x] Add automated backend tests and a Postman collection for manual API
  verification.

### Acceptance Criteria

- [x] Credentials are never stored or logged in plaintext.
- [x] Passwords use Argon2id hashes and the JWT signing secret remains a local
  environment value.
- [x] Login accepts either username or email and returns a short-lived access
  token plus a rotating opaque refresh token.
- [x] Protected endpoints reject missing, invalid, and expired access tokens.
- [x] Refresh tokens are stored as hashes, expire after the configured period,
  rotate on refresh, and are revoked by logout.
- [x] The Angular renderer has no direct access to Node APIs, access tokens,
  or refresh tokens.
- [x] Login, session restoration after Electron restart, and logout were
  verified end to end.

## Phase 2 — Servers and Channels

Phase 2 is complete. Its design and acceptance criteria are documented in
[`phase-2-servers-channels.md`](./phase-2-servers-channels.md).

### Objective

Establish servers, server membership, and text channels for authenticated
users, including the authorization boundaries needed for future messages.

### Approved Scope

- Authenticated users can create servers and become their server-level owner.
- New servers receive a default `general` text channel atomically.
- Server-level roles start with `owner` and `member`.
- Members can list and leave their servers; the last owner cannot leave.
- The authenticated desktop shell lists servers and their text channels.

### Explicitly Out of Scope

- Messages, invitations, server deletion, and fine-grained permissions.
- WebSocket, presence, notifications, and automatic reconnection.
- Voice, video, screen sharing, LiveKit, and WebRTC.

### Delivered Scope

- [x] Add OpenAPI contracts and Postman coverage for servers, channels, and
  safe server departure.
- [x] Add versioned migrations for servers, memberships, and text channels.
- [x] Create a server, its owner membership, and `general` channel atomically.
- [x] Enforce membership for server/channel access and owner-only channel
  creation.
- [x] Prevent the final server owner from leaving.
- [x] Extend Electron's typed preload boundary and the Angular authenticated
  shell for server and channel management.

### Acceptance Criteria

- [x] A signed-in user can create a server and receives an owner membership.
- [x] Server creation atomically creates exactly one `general` text channel.
- [x] Non-members cannot access a server or its channels.
- [x] A non-owner cannot create a channel.
- [x] A member can leave; the last server owner cannot leave.
- [x] The desktop lists servers and channels through typed IPC without exposing
  raw tokens to Angular.

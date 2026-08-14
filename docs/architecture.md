# Architecture

## Principles

brigames-station is designed for a small, private group of users, with approximately 15
concurrent users. The system prioritizes simplicity, correctness,
maintainability, and explicit responsibilities over horizontal scalability.

The application is a modular monolith. It must not introduce microservices,
Redis, Kafka, Kubernetes, or other distributed-system infrastructure without a
concrete requirement.

## High-Level Architecture

```text
                          Desktop Client
                    Electron + Angular + TypeScript
                               |
                         HTTPS / WebSocket
                               |
                               v
                         Go Backend
              REST API, authorization, domain logic,
                 presence, and realtime control plane
                               |
                               v
                          PostgreSQL

                 Future media-plane integration

                          Desktop Client
                               |
                             WebRTC
                               |
                               v
                        LiveKit SFU
```

The Go backend owns the control plane. LiveKit, when introduced in a future
phase, owns the media plane. The backend authorizes media sessions, but it must
not proxy audio, video, or screen-sharing traffic.

## Phase 0 Architecture

Phase 0 establishes the development foundation only. Its active runtime path
is:

```text
Desktop application --HTTP--> Go backend --PostgreSQL--> PostgreSQL
```

PostgreSQL runs through Docker Compose. The Go backend, Angular application,
and Electron application run locally during development.

The backend exposes two operational endpoints:

- `GET /health`: liveness check. It confirms that the backend process can
  serve HTTP and does not depend on PostgreSQL.
- `GET /ready`: readiness check. It confirms that the backend is ready to
  serve requests by verifying PostgreSQL connectivity.

The initial Electron security boundary requires `contextIsolation=true` and
`nodeIntegration=false`. The preload exposes only the minimal, explicitly
typed API required by the renderer.

## Approved Technical Choices

- HTTP contracts are defined with OpenAPI as the source of truth.
- Go uses Gin for HTTP routing and middleware.
- PostgreSQL access uses `pgx`.
- Database migrations are versioned SQL files.
- TypeScript packages are managed with pnpm workspaces.

## Explicitly Out of Scope for Phase 0

- Authentication and authorization implementation.
- WebSocket and presence implementation.
- LiveKit and WebRTC integration.
- Redis.
- Users, servers, channels, messages, and all other business-domain features.

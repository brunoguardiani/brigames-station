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

                    Hybrid realtime media plane

                  Desktop Client <--- WebRTC ---> LiveKit SFU  (voice)

                  Desktop Client <---- WebRTC ----> Desktop Client
                         \                              /
                          \--- HTTPS / WSS signaling ---/
                                       |
                                       v
                                  Go Backend
```

The Go backend owns the control plane. LiveKit continues to carry voice, while
camera and screen-sharing use direct WebRTC peer connections between authorized
desktop clients. The backend authorizes the peer connections and carries their
signaling only; it must not proxy camera or screen-sharing traffic. The initial
P2P delivery uses Cloudflare's public STUN endpoint for ICE discovery and
intentionally has no TURN relay.

Phase 10 is still in progress. STUN discovery does not guarantee connectivity
through every NAT or firewall, and there is no VPS media fallback when a direct
connection cannot be established. During ICE negotiation, peers can learn
network-address metadata about each other; Cloudflare receives connectivity
metadata but does not receive or relay the media.

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

## Production Deployment Baseline

The initial production environment is a single remote VPS for a small private
group, targeting approximately 15 concurrent users.

```text
Desktop Electron -> HTTPS / WSS -> TLS reverse proxy -> Go backend -> managed PostgreSQL
```

- The reverse proxy terminates TLS and forwards HTTPS/WSS traffic to the backend.
- PostgreSQL may be a managed remote service. Its connection is restricted to
  the API host where supported, uses TLS, and its connection string is supplied
  only through the host environment.
- Production secrets, including `AUTH_JWT_SECRET`, are supplied by the host environment and never committed.
- WebSocket endpoints authenticate connections, validate allowed origin, and bound message size.
- Logs must not contain credentials, JWTs, refresh tokens, invite codes, or message content.
- PostgreSQL requires automated backups before the service is opened to users.

The in-progress Phase 10 keeps LiveKit for voice and migrates only camera and
screen sharing to P2P WebRTC. Go retains authorization and signaling for those
flows and never proxies their media.

## Explicitly Out of Scope for Phase 0

- Authentication and authorization implementation.
- WebSocket and presence implementation.
- LiveKit and WebRTC integration.
- Redis.
- Users, servers, channels, messages, and all other business-domain features.

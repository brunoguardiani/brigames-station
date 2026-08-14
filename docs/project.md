# Project Overview

## Purpose

brigames-station is a personal desktop communication application inspired by Discord.

The application is intended for private use by the owner and a small group of friends.

The expected scale is approximately:

- Up to 15 concurrent users.
- Small number of servers.
- Small number of channels.
- Low message volume.
- Voice/video communication is a primary feature.
- Screen sharing is supported.
- Camera and microphone are supported.

The project is intentionally designed for small-scale usage.

The goal is not to reproduce Discord's infrastructure or scalability.

The goal is to build a well-structured, maintainable realtime communication platform while exploring:

- Desktop application development.
- Go backend development.
- WebSockets.
- Realtime state management.
- WebRTC.
- SFU architecture.
- Voice/video communication.
- Screen sharing.
- Authentication and authorization.
- PostgreSQL.
- Docker.
- Software architecture.

---

# Product Concept

The application provides:

- User authentication.
- User profiles.
- Servers/groups.
- Server membership.
- Text channels.
- Voice channels.
- Realtime text messaging.
- Online/offline presence.
- Voice communication.
- Camera.
- Screen sharing.
- User mute/deafen controls.
- Individual user volume control.
- Desktop notifications.
- System tray integration.
- Automatic reconnection.

The application should feel like a lightweight private Discord alternative.

---

# Target Platform

The primary target is desktop.

Initial target operating systems:

- Windows
- Linux

macOS may be supported later.

---

# Core Technologies

## Desktop

- Electron
- Angular
- TypeScript

## Backend

- Go
- REST API
- WebSocket

## Database

- PostgreSQL

## Realtime Media

Initial approach:

- LiveKit
- WebRTC
- SFU architecture

Alternative technologies may be evaluated later:

- mediasoup
- Pion WebRTC

## Infrastructure

- Docker
- Docker Compose
- Single VPS initially

Redis is optional and should only be introduced when there is a concrete architectural requirement.

---

# Phase 0 Foundation

Phase 0 establishes only the local development foundation. PostgreSQL runs via
Docker Compose, while Go, Angular, and Electron run locally. HTTP contracts use
OpenAPI as their source of truth; the backend uses Gin, `pgx`, and versioned
SQL migrations.

For this phase, `GET /health` is a liveness endpoint independent of PostgreSQL,
and `GET /ready` verifies PostgreSQL readiness. Electron must use
`contextIsolation=true`, `nodeIntegration=false`, and a minimal preload API.

LiveKit, WebRTC, WebSocket, Redis, authentication, and all business-domain
features are intentionally outside Phase 0.

---

# Architectural Philosophy

The system should remain intentionally simple.

Do not introduce:

- Microservices
- Kubernetes
- Kafka
- Event sourcing
- CQRS
- Service mesh
- Distributed databases

unless there is a demonstrated requirement.

The expected scale does not justify those technologies.

Prefer:

- Modular monolith.
- Clear domain boundaries.
- Explicit interfaces where useful.
- Simple infrastructure.
- Strong typing.
- Automated tests.
- Observable behavior.
- Clear error handling.
- Explicit ownership of state.

---

# Important Architectural Principle

Separate the control plane from the media plane.

## Control Plane

Owned by the Go backend.

Responsibilities:

- Authentication.
- Authorization.
- Users.
- Servers.
- Channels.
- Messages.
- Permissions.
- Presence.
- Voice session metadata.
- WebSocket events.
- Media session authorization.

## Media Plane

Owned by the SFU.

Responsibilities:

- Audio.
- Camera.
- Screen sharing.
- WebRTC connections.
- Media routing.

The Go backend must not proxy audio/video traffic.

---

# Scale Assumptions

The architecture should optimize for:

- 15 concurrent users.
- One VPS.
- One backend instance initially.
- One PostgreSQL instance.
- One SFU instance.

Scalability beyond this is not currently a requirement.

When making architectural decisions, optimize for simplicity and correctness before scalability.

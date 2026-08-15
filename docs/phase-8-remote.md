# Phase 8 — Remote Environment

## Objective

Deploy the control plane safely to a single remote VPS while using managed
PostgreSQL. This phase is delivered in small independently verifiable steps;
the desktop continues to run on user machines.

## Approved Topology

```text
Electron desktop -> HTTPS/WSS -> Nginx -> Go API -> Supabase PostgreSQL
                                      |
                                      `-> LiveKit (next delivery)
```

- The initial VPS is Amazon Lightsail running Ubuntu 24.04.
- PostgreSQL is Supabase-managed and is reached over TLS through its session
  pooler; no PostgreSQL container runs on the VPS.
- Nginx and the Go API run as separate Docker Compose services.
- The deployment key held by the VPS is read-only and may only read this
  repository.

## Delivery 1 — API Runtime

This delivery supplies a reproducible API runtime without exposing a database
or configuring public voice media yet.

- `apps/server/Dockerfile` builds the API and explicit administration tools.
- `docker-compose.production.yml` runs API and Nginx only; migrations and the
  owner seed are opt-in tools and never run at API startup.
- `.env.production` exists only on the VPS and is ignored by Git.
- HTTP is temporarily used only for an IP-based health check. HTTPS, a domain,
  WSS, LiveKit/TURN, and desktop release configuration are subsequent
  deliveries.

## Operational Rules

- Never commit `.env.production`, database credentials, JWT secrets, or
  LiveKit keys.
- Apply migrations explicitly before starting a new API release.
- The Supabase project remains the source of database backups; the VPS stores
  no database volume.
- The Lightsail firewall exposes only ports required by the active delivery.

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

## Delivery 2 — API TLS

- `api.groupgo.com.br` resolves to the Lightsail static IP.
- The base Compose file keeps Nginx on HTTP solely to serve the ACME webroot.
- `certbot` is an opt-in Compose tool using the official pinned Certbot image.
- After the initial certificate is issued, `docker-compose.tls.yml` replaces
  the Nginx configuration with HTTPS/WSS and redirects HTTP to HTTPS.
- Certificate renewal uses the same persistent Docker volumes; Nginx must be
  reloaded after a successful renewal.

## Delivery 3 — LiveKit Voice Runtime

- `docker-compose.livekit.yml` is an opt-in overlay on the production and TLS
  Compose files; it runs exactly one pinned LiveKit node and introduces no
  Redis dependency.
- Signaling uses `wss://livekit.groupgo.com.br` through Nginx and a separate
  trusted TLS certificate.
- Media uses `7882/UDP` with UDP mux and `7881/TCP` as the ICE fallback. Both
  ports must be opened in the Lightsail firewall before client testing.
- LiveKit receives its API credentials only from `.env.production` through
  `LIVEKIT_KEYS`, in the exact `key: secret` format; that key/secret pair must
  match the API's `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
- TURN is intentionally deferred. It is needed as a connectivity fallback for
  restrictive networks, not to operate the initial small single-VPS service.

## Operational Rules

- Never commit `.env.production`, database credentials, JWT secrets, or
  LiveKit keys.
- Apply migrations explicitly before starting a new API release.
- The Supabase project remains the source of database backups; the VPS stores
  no database volume.
- The Lightsail firewall exposes only ports required by the active delivery.

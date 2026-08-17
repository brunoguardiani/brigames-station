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

## Delivery 4 — Operations

### TLS renewal

`scripts/renew-tls.sh` renews certificates through the existing Certbot
webroot and reloads Nginx only after a successful renewal. Install its timer
on the VPS with:

```bash
sudo cp infra/systemd/brigames-tls-renew.service /etc/systemd/system/
sudo cp infra/systemd/brigames-tls-renew.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now brigames-tls-renew.timer
systemctl list-timers brigames-tls-renew.timer
```

The timer runs twice daily; Certbot performs no certificate change until a
renewal is due. A manual verification is safe:

```bash
sudo systemctl start brigames-tls-renew.service
sudo journalctl -u brigames-tls-renew.service -n 50 --no-pager
```

### Routine deployment and validation

Run migrations explicitly before an API release, then update the services:

```bash
cd /opt/brigames-station
git pull --ff-only
docker compose -f docker-compose.production.yml --profile tools run --rm migrate
docker compose -f docker-compose.production.yml -f docker-compose.tls.yml -f docker-compose.livekit.yml up -d --build api nginx livekit
docker compose -f docker-compose.production.yml -f docker-compose.tls.yml -f docker-compose.livekit.yml ps
curl --fail https://api.groupgo.com.br/health
curl --fail https://api.groupgo.com.br/ready
```

Use `docker compose ... logs --tail=100 api nginx livekit` for runtime logs.
Supabase remains responsible for PostgreSQL backups; no database volume exists
on the VPS.

### Rollback

Keep a known-good Git commit. To return to it, stop at the checkout before
touching database migrations, then redeploy the same Compose command:

```bash
cd /opt/brigames-station
git log --oneline
git switch --detach <known-good-commit>
docker compose -f docker-compose.production.yml -f docker-compose.tls.yml -f docker-compose.livekit.yml up -d --build api nginx livekit
```

Do not roll back a database schema unless the associated migration has an
explicit reverse migration and the release plan permits it.

### GitHub Actions

`.github/workflows/ci.yml` runs on pushes and pull requests. It tests and
vets the Go server, builds the Windows installer, uploads that installer as a
14-day workflow artifact, and validates the production Compose overlays. It
never connects to the VPS.

`.github/workflows/deploy-production.yml` is dispatch-only. It checks out the
selected ref, resolves it to an immutable commit, and deploys only after the
GitHub `production` environment authorizes the run. Configure required
reviewers for that environment before using it.

Create these environment-scoped GitHub Secrets for the deploy workflow:

- `VPS_HOST`: Lightsail public IP or host name.
- `VPS_USER`: the restricted Linux deployment user.
- `VPS_SSH_PRIVATE_KEY`: a dedicated GitHub Actions private key. Add only its
  public key to that user's `~/.ssh/authorized_keys` on the VPS; do not reuse a
  personal SSH key.
- `VPS_SSH_KNOWN_HOSTS`: the verified `known_hosts` line for the VPS, obtained
  from a trusted connection. This prevents the workflow from trusting an
  arbitrary host key at deploy time.

## Operational Rules

- Never commit `.env.production`, database credentials, JWT secrets, or
  LiveKit keys.
- Apply migrations explicitly before starting a new API release.
- The Supabase project remains the source of database backups; the VPS stores
  no database volume.
- The Lightsail firewall exposes only ports required by the active delivery.

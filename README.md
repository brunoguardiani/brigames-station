# brigames-station

brigames-station is a private desktop communication application for a small group of
friends. It is being developed as a modular monolith with Electron, Angular,
TypeScript, Go, PostgreSQL, and OpenAPI HTTP contracts.

## Repository foundation

The repository includes a Go health service and local PostgreSQL Compose
configuration. It does not yet contain an Angular application, Electron
runtime, migrations, authentication, realtime features, or business domains.

```text
apps/desktop/       Desktop application skeleton
apps/server/        Go backend skeleton
packages/protocol/  Future OpenAPI HTTP contracts
infra/              Future local infrastructure configuration
```

## Prerequisites

- Node.js with Corepack enabled
- pnpm

## Initialize the workspace

```powershell
corepack enable
pnpm install
```

`pnpm install` currently installs no application dependencies. The remaining
Phase 0 steps will add the approved Angular and Electron implementation pieces.

## Run the health service locally

1. Copy `.env.example` to `.env` and replace `POSTGRES_PASSWORD` with a local
   development password. Keep `DATABASE_URL` consistent with that password.
2. Start PostgreSQL:

   ```powershell
   docker compose up -d postgres
   ```

3. Start the Go backend:

   ```powershell
   Set-Location apps/server
   go run ./cmd/api
   ```

4. In another terminal, verify the endpoints:

   ```powershell
   Invoke-WebRequest http://localhost:8080/health
   Invoke-WebRequest http://localhost:8080/ready
   ```

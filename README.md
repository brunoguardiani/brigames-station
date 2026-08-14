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
   Get-Content .env | ForEach-Object {
     if ($_ -match '^\s*([^#=]+)=(.*)$') {
       Set-Item -Path "Env:$($matches[1].Trim())" -Value $matches[2].Trim()
     }
   }
   Set-Location apps/server
   go run ./cmd/api
   ```

   Run the environment-loading snippet in each terminal that starts a Go
   command. The backend reads operating-system environment variables and does
   not load `.env` files by itself.

   Migrations are always explicit and are not run by the API. Run them in a
   separate terminal when versioned SQL files are available:

   ```powershell
   Set-Location apps/server
   go run ./cmd/migrate
   ```

4. In another terminal, verify the endpoints:

   ```powershell
   Invoke-WebRequest http://localhost:8080/health
   Invoke-WebRequest http://localhost:8080/ready
   ```

## Run the desktop application

With the backend running, build and open the Electron application:

```powershell
pnpm --filter @brigames-station/desktop run build
pnpm --filter @brigames-station/desktop run electron
```

For Angular development with live reload, use two terminals. Start the Angular
development server in the first:

```powershell
pnpm --filter @brigames-station/desktop run serve
```

Then start Electron in the second terminal:

```powershell
$env:ELECTRON_RENDERER_URL = "http://127.0.0.1:4200"
pnpm --filter @brigames-station/desktop run electron
```

The Electron renderer has no Node integration. It obtains the backend health
status through the limited preload API exposed as `window.desktop.backend`.

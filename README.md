# brigames-station

brigames-station is a private desktop communication application for a small group of
friends. It is being developed as a modular monolith with Electron, Angular,
TypeScript, Go, PostgreSQL, and OpenAPI HTTP contracts.

## Repository foundation

The repository includes a Go API, local PostgreSQL Compose configuration,
versioned SQL migrations, authentication endpoints, and an Angular/Electron
desktop health-status screen. Realtime features and the remaining business
domains are not implemented yet.

```text
apps/desktop/       Angular renderer and Electron shell
apps/server/        Go backend and migration command
packages/protocol/  OpenAPI HTTP contracts
infra/              Local infrastructure structure
```

## Prerequisites

- Node.js with Corepack enabled
- pnpm
- Go
- Docker Desktop

## Initialize the workspace

```powershell
corepack enable
pnpm install
```

`pnpm install` installs the workspace dependencies for Angular and Electron.

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
   separate terminal:

   ```powershell
   Set-Location apps/server
   go run ./cmd/migrate
   ```

   To make the database match a specific migration, pass its identifier. Any
   later migrations are reversed automatically:

   ```powershell
   go run ./cmd/migrate 000001_create_users
   ```

   Use `go run ./cmd/migrate status` to list migration state. The migration
   format and local rollback guidance are documented in
   [`apps/server/migrations/README.md`](./apps/server/migrations/README.md).

4. In another terminal, verify the endpoints:

   ```powershell
   Invoke-WebRequest http://localhost:8080/health
   Invoke-WebRequest http://localhost:8080/ready
   ```

## Test authentication with Postman

Import `packages/protocol/postman/brigames-station.postman_collection.json`
into Postman. The collection uses `http://127.0.0.1:8080` by default.

For a member registration test, set `AUTH_REGISTRATION_ENABLED=true` in the
local `.env` and restart the API. Run Register, Login, Me, Refresh, and Logout
in that order. Login stores the tokens as Postman collection variables. Return
the registration flag to `false` after testing.

## Test servers and channels

After Login in the imported Postman collection, run the requests in
`Servers and Channels (Phase 2)` in this order: Create Server, List Servers,
List Channels, and Create Channel. Create Server stores the returned identifier
in the collection's `serverId` variable and creates the `general` channel
automatically. Leaving a server is expected to return `409` for its last
owner.

## Run the desktop application

With the backend running, build and open the Electron application:

```powershell
pnpm --filter @brigames-station/desktop run build
pnpm --filter @brigames-station/desktop run electron
```

## Build the Windows installer

Create the 64-bit NSIS installer from the workspace root:

```powershell
pnpm --filter @brigames-station/desktop run dist:win
```

The artifact is written to
`apps/desktop/release/brigames-station-Setup-<version>.exe`. The packaged
application defaults to `https://api.groupgo.com.br`; a local development
session may still override it with `DESKTOP_BACKEND_URL`.

The first public builds are not code signed, so Windows may display an
"unknown publisher" warning. Distribute the installer only through a trusted
channel and provide its SHA-256 checksum alongside the file.

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

The Electron renderer has no Node integration. It obtains operational,
authentication, server, and channel data only through the limited preload API.

## Verify Phase 0

With PostgreSQL and the backend running, `/health` and `/ready` must both
return `200`. The desktop must show `available`. Stop the backend process and,
within five seconds, the desktop must change to `unavailable`.
# brigames-station

## Local infrastructure

Start PostgreSQL and the local LiveKit development server:

```powershell
docker compose up -d
```

LiveKit is exposed locally at `ws://127.0.0.1:7880` with the development-only
credentials documented in `.env.example`. These credentials must never be used
outside local development. Docker Compose also exposes the local WebRTC UDP
port `7882`.

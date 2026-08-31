# brigames-station

brigames-station is a private desktop communication application for a small group of
friends. It is being developed as a modular monolith with Electron, Angular,
TypeScript, Go, PostgreSQL, and OpenAPI HTTP contracts.

## Repository foundation

The repository includes a Go API, PostgreSQL and LiveKit development
infrastructure, versioned SQL migrations, authenticated server/channel/message
domains, realtime WebSocket delivery, and an Angular/Electron desktop client.
Voice uses LiveKit; the in-progress Phase 10 moves camera and screen sharing to
direct P2P WebRTC.

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

## Build a desktop installer locally

The same script builds the installer for the operating system on which it is
run and creates a SHA-256 checksum alongside every generated installer:

```bash
node scripts/build-desktop-installer.mjs
```

For subsequent builds, when the workspace dependencies are already installed:

```bash
node scripts/build-desktop-installer.mjs --skip-install
```

Run it from the repository root on the target operating system:

| Build machine | Generated artifacts in `apps/desktop/release/` |
| --- | --- |
| Windows x64 | `brigames-station-Setup-<version>.exe` and `.exe.sha256` |
| macOS Intel or Apple Silicon | Intel and Apple Silicon `.dmg` files, each with `.sha256`; ZIP payloads are also generated for the updater |
| Linux x64 | `.AppImage` and `.deb` files, each with `.sha256` |

The script intentionally builds only the current operating system. Generate a
Windows installer on Windows, DMGs on macOS, and Linux packages on Linux. The
packaged application defaults to `https://api.groupgo.com.br`; a local
development session may still override it with `DESKTOP_BACKEND_URL`.

Increase `version` in `apps/desktop/package.json` before distributing an
update. The stable application identifier lets the Windows installer update an
existing installation, while the higher version distinguishes the release.

The first builds are not code signed, so Windows may display an
"unknown publisher" warning. Distribute the installer only through a trusted
channel and provide its SHA-256 checksum alongside the file.

## Create a desktop release

Releases are manual and never run on `push`. First update the `version` in
`apps/desktop/package.json`, commit it, and wait for the CI on `main` to pass.
Then open **Actions -> Release desktop applications -> Run workflow** while `main`
is selected. The workflow creates a private GitHub Release with:

- the Windows x64 installer and SHA-256 checksum;
- macOS Apple Silicon (`arm64`) and Intel (`x64`) DMG installers, each with a
  SHA-256 checksum, plus the updater ZIP payloads and metadata;
- Linux x64 AppImage and Debian (`.deb`) packages, each with a SHA-256
  checksum.

Download the correct installer and checksum from the Release and distribute
them through a trusted channel. The macOS builds are not yet signed or
notarized, so they are intended for controlled testing until Apple Developer
signing is configured.

## Desktop automatic updates

Packaged Windows builds include a background updater. It checks shortly after
startup and then only at a conservative interval, downloads a newer release in
the background, and asks whether to restart and install it. Development runs do
not contact the update provider. The Angular renderer accesses updater state
only through the typed, context-isolated preload API.

The release workflow publishes `latest*.yml` manifests and blockmaps alongside
the installers. However, the current GitHub repository is private, and a
private GitHub Release cannot be read anonymously by installed clients. Do not
embed `GH_TOKEN` in the app. Automatic updates become operational only after
the release assets are hosted on a publicly readable feed; manual installation
continues to work in the meantime.

See [`docs/desktop-auto-update.md`](docs/desktop-auto-update.md) for the release
assets, public-feed decision, signing requirements, end-to-end test procedure,
and macOS/Linux differences.

## Install on Pop!_OS / Debian / Ubuntu

Download the Linux package and its matching `.sha256` file from the private
GitHub Release. Verify it before installing:

```bash
cd ~/Downloads
sha256sum -c brigames-station-<version>-<architecture>.<extension>.sha256
```

Use the AppImage for a portable installation:

```bash
chmod +x brigames-station-<version>-x86_64.AppImage
./brigames-station-<version>-x86_64.AppImage
```

To update an AppImage, verify and replace the old AppImage with the new one.
To uninstall it, remove that file.

Use the Debian package for system-managed installation on Pop!_OS, Ubuntu, or
Debian:

```bash
sudo apt install ./brigames-station-<version>-amd64.deb
brigames-station
```

Install a newer `.deb` with the same command to update the application. To
uninstall it:

```bash
sudo apt remove brigames-station
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

The Electron renderer has no Node integration. It obtains operational,
authentication, server, and channel data only through the limited preload API.

## P2P camera and screen sharing

Phase 10 keeps voice on LiveKit and sends camera, screen sharing, and optional
selected system audio directly between desktop clients. Publishing announces
availability only; each viewer explicitly chooses which transmission to
receive and can stop watching it independently.

`WEBRTC_STUN_URL` configures ICE discovery in Electron. The documented default
is Cloudflare's public `stun:stun.cloudflare.com:3478`. STUN receives
connectivity metadata but never the media stream. WebRTC peers can learn
network-address metadata about each other during ICE negotiation.

There is intentionally no TURN or VPS media fallback. Clients need working
HTTPS/WSS access to the API and network conditions that permit a direct WebRTC
connection. Restrictive NAT or firewall combinations may prevent camera or
screen viewing even while voice remains available through LiveKit.

## Verify Phase 0

With PostgreSQL and the backend running, `/health` and `/ready` must both
return `200`. The desktop must show `available`. Stop the backend process and,
within five seconds, the desktop must change to `unavailable`.

## Local infrastructure

Start PostgreSQL and the local LiveKit development server:

```powershell
docker compose up -d
```

LiveKit is exposed locally at `ws://127.0.0.1:7880` with the development-only
credentials documented in `.env.example`. These credentials must never be used
outside local development. Docker Compose also exposes UDP port `7882` for the
LiveKit voice service; camera and screen-sharing P2P connections do not use
LiveKit's media port.

# Roadmap

## Roadmap Principles

The roadmap is organized by functional milestones rather than fixed dates. A
milestone is complete only when its acceptance criteria are met. Implement
features incrementally and do not introduce future-phase infrastructure without
a concrete requirement.

## Phase 0 — Project Foundation

### Objective

Create a repeatable local development environment and demonstrate the minimum
end-to-end path from the desktop application to the Go backend and PostgreSQL.

### Approved Scope

- brigames-station is a pnpm-workspace monorepo.
- PostgreSQL runs through Docker Compose.
- Go, Angular, and Electron run locally during development.
- HTTP contracts use OpenAPI as their source of truth.
- The backend uses Gin and `pgx`.
- Migrations are versioned SQL files.
- Electron uses `contextIsolation=true`, `nodeIntegration=false`, and a minimal
  preload API.

### Explicitly Out of Scope

- Authentication and authorization.
- WebSocket, presence, and automatic reconnection.
- LiveKit, WebRTC, voice, video, and screen sharing.
- Redis.
- Users, profiles, servers, memberships, channels, messages, and permissions.
- Notifications and system tray integration.

### Tasks

#### Repository and Documentation

- [x] Create the approved monorepo structure.
- [x] Configure pnpm workspaces.
- [x] Configure `.gitignore`.
- [x] Create `.env.example`.
- [x] Add the initial OpenAPI contract for operational endpoints.
- [x] Keep project documentation aligned with the approved architecture.

#### Infrastructure and Database

- [x] Create Docker Compose configuration for PostgreSQL.
- [x] Configure persistent local database storage.
- [x] Configure environment variables for local PostgreSQL access.
- [x] Initialize versioned SQL migration infrastructure.
- [x] Configure `pgx` database connectivity in the backend.

#### Backend

- [x] Initialize the Go module and backend entrypoint.
- [x] Create validated configuration loading.
- [x] Create the HTTP server using Gin.
- [x] Implement structured logging.
- [x] Implement graceful shutdown.
- [x] Implement `GET /health` as a liveness endpoint independent of PostgreSQL.
- [x] Implement `GET /ready` as a PostgreSQL readiness endpoint.

#### Desktop

- [x] Initialize the Angular application.
- [x] Initialize Electron and integrate it with Angular development and build.
- [x] Create the initial application window.
- [x] Establish the secure preload boundary.
- [x] Query the backend operational endpoint from the desktop application.
- [x] Display loading, available, and unavailable backend states.

#### Verification

- [x] Document local startup and verification steps.
- [x] Validate the complete desktop-to-backend-to-PostgreSQL path.

### Required Implementation Order

1. Create the repository structure, workspace configuration, ignore rules, and
   environment example.
2. Add the OpenAPI definition for `GET /health` and `GET /ready`.
3. Configure Docker Compose and PostgreSQL.
4. Initialize the Go module, configuration, structured logging, and graceful
   shutdown.
5. Configure `pgx` and the versioned SQL migration infrastructure.
6. Implement the HTTP server, liveness endpoint, and readiness endpoint.
7. Initialize Angular and Electron, including the secure preload boundary.
8. Implement the desktop health-status view against the approved HTTP contract.
9. Verify the acceptance criteria and document the local workflow.

### Acceptance Criteria

- PostgreSQL starts through Docker Compose with persistent local storage.
- Versioned SQL migrations can be applied repeatably to an empty database.
- The backend starts with validated configuration, structured logs, and graceful
  shutdown.
- `GET /health` succeeds while the HTTP process is alive, even if PostgreSQL is
  unavailable.
- `GET /ready` succeeds only when PostgreSQL connectivity is available.
- Electron opens an Angular window with context isolation enabled and Node
  integration disabled.
- The desktop application displays the backend availability state.
- No secrets are committed; all required variables are documented in
  `.env.example`.

## Phase 1 — Identity and Access

Phase 1 is complete. Its approved design and implementation detail are
documented in [`phase-1-identity.md`](./phase-1-identity.md).

### Delivered Scope

- [x] Add OpenAPI contracts for registration, login, refresh, logout, and
  current-user operations.
- [x] Add versioned SQL migrations for global roles, users, and refresh tokens.
- [x] Add secure first-owner bootstrap through `cmd/seed-owner`; no
  credential is stored in migrations or source control.
- [x] Add Argon2id password hashing, JWT access tokens, opaque hashed refresh
  tokens, refresh-token rotation, and logout revocation.
- [x] Add authentication middleware and the protected `GET /me` endpoint.
- [x] Add desktop login, secure encrypted refresh-token storage in the
  Electron main process, automatic access-token renewal, session restoration,
  and logout.
- [x] Add automated backend tests and a Postman collection for manual API
  verification.

### Acceptance Criteria

- [x] Credentials are never stored or logged in plaintext.
- [x] Passwords use Argon2id hashes and the JWT signing secret remains a local
  environment value.
- [x] Login accepts either username or email and returns a short-lived access
  token plus a rotating opaque refresh token.
- [x] Protected endpoints reject missing, invalid, and expired access tokens.
- [x] Refresh tokens are stored as hashes, expire after the configured period,
  rotate on refresh, and are revoked by logout.
- [x] The Angular renderer has no direct access to Node APIs, access tokens,
  or refresh tokens.
- [x] Login, session restoration after Electron restart, and logout were
  verified end to end.

## Phase 2 — Servers and Channels

Phase 2 is complete. Its design and acceptance criteria are documented in
[`phase-2-servers-channels.md`](./phase-2-servers-channels.md).

### Objective

Establish servers, server membership, and text channels for authenticated
users, including the authorization boundaries needed for future messages.

### Approved Scope

- Authenticated users can create servers and become their server-level owner.
- New servers receive a default `general` text channel atomically.
- Server-level roles start with `owner` and `member`.
- Members can list and leave their servers; the last owner cannot leave.
- The authenticated desktop shell lists servers and their text channels.

### Explicitly Out of Scope

- Messages, invitations, server deletion, and fine-grained permissions.
- WebSocket, presence, notifications, and automatic reconnection.
- Voice, video, screen sharing, LiveKit, and WebRTC.

### Delivered Scope

- [x] Add OpenAPI contracts and Postman coverage for servers, channels, and
  safe server departure.
- [x] Add versioned migrations for servers, memberships, and text channels.
- [x] Create a server, its owner membership, and `general` channel atomically.
- [x] Enforce membership for server/channel access and owner-only channel
  creation.
- [x] Prevent the final server owner from leaving.
- [x] Extend Electron's typed preload boundary and the Angular authenticated
  shell for server and channel management.

### Acceptance Criteria

- [x] A signed-in user can create a server and receives an owner membership.
- [x] Server creation atomically creates exactly one `general` text channel.
- [x] Non-members cannot access a server or its channels.
- [x] A non-owner cannot create a channel.
- [x] A member can leave; the last server owner cannot leave.
- [x] The desktop lists servers and channels through typed IPC without exposing
  raw tokens to Angular.

## Phase 3 — Text Messages

Phase 3 adds persistent, paginated text messages through HTTP. Its approved
scope is documented in [`phase-3-messages.md`](./phase-3-messages.md).

1. Extend OpenAPI with message contracts.
2. Add the messages migration, authorization, and tests.
3. Add HTTP handlers and Postman coverage.
4. Extend Electron and Angular for listing and sending messages.

### Delivered Scope

- [x] Add message contracts, migration, membership authorization, and tests.
- [x] Add HTTP list/create operations and Postman coverage.
- [x] Extend Electron and Angular to display and send channel messages.

## Phase 4 — Temporary Server Invites

Phase 4 is complete. It adds private, shared invite codes that expire after 24
hours. Its scope is documented in [`phase-4-invites.md`](./phase-4-invites.md).

### Delivered Scope

- [x] Add versioned persistence for hashed, 24-hour server invite codes.
- [x] Allow server owners to create and revoke invites.
- [x] Allow authenticated users to join a server as a member through a valid
  invite, idempotently.
- [x] Extend the desktop application with invite creation and join flows.

## Phase 5 - Realtime Text Delivery

Phase 5 is complete. It adds authenticated WebSocket delivery for newly
created text messages. Its scope is documented in
[`phase-5-realtime-messages.md`](./phase-5-realtime-messages.md).

### Delivered Scope

- [x] Add an authenticated WebSocket endpoint with bounded initial payload.
- [x] Publish `message.created` only to the current members of the channel's
  server.
- [x] Keep the WebSocket hub in the Go process; Redis and multi-instance
  fan-out remain out of scope.
- [x] Keep tokens and the WebSocket client in the Electron main process.
- [x] Add typed, minimal IPC events to Angular and reconnect with bounded exponential backoff.
- [x] Verify delivery of `message.created` between two authenticated clients.

## Phase 6 — Voice Channels

Phase 6 adds local, self-hosted LiveKit voice channels. Its design and
operational limits are documented in [`phase-6-voice.md`](./phase-6-voice.md).

### Delivered Scope

- [x] Add the `voice` channel type with a reversible SQL migration.
- [x] Add a membership-gated API that issues short-lived LiveKit room tokens.
- [x] Add the voice-token HTTP contract and Postman manual check.
- [x] Start a local LiveKit development service through Docker Compose.
- [x] Add Electron IPC and a desktop voice-channel join/leave flow.

### Deferred Scope

- Transferred to and completed in Phase 9: video and screen sharing.
- Transferred to and completed in Phase 8: public deployment, TLS, and
  production LiveKit secrets.
- Recording, device selection, and TURN configuration remain deferred.

## Phase 7 — Presence and Voice Controls

Phase 7 is complete. It extends the local desktop experience with presence
visibility and essential voice controls while retaining the single-process
realtime hub appropriate for the current deployment model.

### Delivered Scope

- [x] Add an authenticated server-members endpoint that returns membership
  role and current in-process online state.
- [x] Publish `presence.changed` only to users sharing at least one server
  with the connecting or disconnecting member.
- [x] Extend the typed Electron IPC boundary for member listing and presence
  events; tokens remain in the Electron main process.
- [x] Display online and offline members in a right-side server panel.
- [x] Display voice-channel participants beneath the active voice channel.
- [x] Indicate the active speaker with a green ring around their avatar.
- [x] Add compact microphone mute and call-leave controls above the account
  logout area.
- [x] Track each connected member's current voice channel through the
  authenticated `PUT /voice/presence` endpoint.
- [x] Display participants beneath every voice channel, including for members
  who are not connected to that channel.
- [x] Publish voice-channel assignment changes through the realtime
  `voice.presence.changed` event.

### Operational Limits

- Presence reflects authenticated WebSocket connections in the current Go
  process; it is not durable and is not shared between backend instances.
- Voice-channel presence is also in-process and non-durable; it is cleared on
  disconnect and is not shared between backend instances.
- Redis, distributed fan-out, and cross-instance presence remain out of scope.

### Acceptance Criteria

- [x] Only a server member can list the members of that server.
- [x] Members sharing a server receive online/offline updates without polling.
- [x] The desktop visibly distinguishes online from offline members.
- [x] Voice participants are visible beneath every voice channel and their
  assignments update through realtime events.
- [x] Active speakers are visible in the desktop UI.
- [x] A connected user can mute/unmute their microphone and leave a call using
  icon-only controls.

## Phase 8 — Remote Environment

Phase 8 prepares a controlled remote deployment in incremental deliveries.
Its active design is documented in [`phase-8-remote.md`](./phase-8-remote.md).

### Delivery 1 — API Runtime

- [x] Provision a Supabase PostgreSQL project and apply the existing schema.
- [x] Provision an Ubuntu 24.04 Lightsail VPS with static IP, restricted SSH,
  HTTP/HTTPS firewall rules, Docker, and a read-only deploy key.
- [x] Add a reproducible API/Nginx production Compose runtime.
- [x] Validate the API through the VPS public IP before enabling TLS.

### Deferred Deliveries

- [x] Configure the public domain, TLS, and production WSS endpoint.
- [x] Deploy a single-node LiveKit runtime with production keys and the
  required TCP/UDP ports. TURN remains a future connectivity enhancement.
- [x] Build and validate the desktop against the remote HTTPS/WSS endpoints.
- [x] Document backups, upgrades, monitoring, rollback, and TLS renewal.

## Phase 9 - Video and Screen Sharing

Phase 9 is complete. It extends the existing LiveKit media plane beyond voice
without changing the Go backend into a media proxy.

### Delivered Scope

- [x] Publish and receive LiveKit camera tracks from the Electron desktop app.
- [x] Select an Electron screen or window source through the typed preload
  boundary and publish it as a LiveKit screen-share track.
- [x] Offer optional system-audio sharing on Windows when the selected source
  and operating system support it.
- [x] Render camera and screen-share tracks in an adaptive, contained media
  stage that does not overflow the application window.
- [x] Let each viewer click a track to feature it, then click it again to
  return all active tracks to an equal grid.
- [x] Keep voice controls available while the media stage is open and hide the
  right-side member panel only while viewing media.
- [x] Add a local indicator beside the voice channel when its media stage is
  actively being viewed.
- [x] Allow Enter to send a text-channel message while Shift+Enter retains a
  multiline message.

### Acceptance Criteria

- [x] A member can publish and stop a camera or a selected screen/window while
  connected to a voice channel.
- [x] Other members in the same LiveKit room receive the published tracks.
- [x] A viewer can feature and unfeature an individual camera or shared screen
  without affecting another viewer's layout.
- [x] Media remains contained within the available desktop viewport.
- [x] Returning to a text channel hides the media stage and restores the text
  chat view.

### Deferred Scope

- Recording, device selection, virtual backgrounds, moderation controls, and
  bandwidth-quality controls.
- TURN relay and broader network-connectivity hardening.

## Phase 10 - P2P Camera and Screen Sharing

Phase 10 is in progress. The authenticated signaling path and the desktop P2P
media path are implemented, but the phase has not yet met its external-network
and multi-user acceptance criteria.

This phase supersedes only the Phase 9 delivery path for camera and screen
sharing. LiveKit remains responsible for voice, and the prior Phase 9
acceptance does not validate the new P2P path.

### Implemented - Pending Acceptance

- [x] Retain the LiveKit room connection and token issuance for voice only.
- [x] Relay bounded, authenticated P2P signaling only between users present in
  the same voice channel.
- [x] Cover signal-envelope validation, self-target rejection, cross-channel
  and cross-server rejection, and valid authenticated relay with backend tests.
- [x] Exchange offers, answers, and ICE candidates through the existing
  authenticated WebSocket without proxying media through Go or the VPS.
- [x] Send camera, screen-share, and optional selected system-audio tracks
  directly between peers.
- [x] Announce transmissions and require each viewer to opt in independently;
  allow that viewer to stop watching without leaving the voice channel.
- [x] Preserve voice controls and implement a contained multi-stream stage with
  viewer-local feature and unfeature state.
- [x] Expose compact per-participant camera and screen indicators, plus an
  in-video control for stopping reception.
- [x] Use configurable Cloudflare STUN discovery with no TURN or VPS media
  fallback.

### Remaining Implementation

- [ ] Surface clear user-facing signaling, permission, ICE, and peer-connection
  failure states.
- [ ] Complete the automated authorization and validation coverage for every
  signaling rejection path.

### Verification Pending

- [ ] Complete the final two-client local regression matrix after the latest UI
  and lifecycle changes.
- [ ] Validate direct media across two distinct external networks.
- [ ] Exercise an approximately ten-member voice-channel scenario; this is a
  design target, not a hard application limit.
- [ ] Verify camera, screen, optional system audio, watch/unwatch,
  feature/unfeature, resize, and peer join/leave behavior together.
- [ ] Confirm camera and screen media bypass the Go/VPS data path and measure
  client and VPS resource usage.

### Approved Decisions

- The design target is approximately ten members in one voice channel. No hard
  numerical limit is enforced, and this is not yet a completed load-test claim.
- There is no enforced numerical limit for cameras or screen shares. Viewers
  opt in to each transmission, so media cost follows actual viewers rather
  than channel membership.
- TURN is not included in the initial delivery. A restrictive network that
  cannot establish a direct WebRTC connection must receive a clear error;
  media must not be relayed through the VPS.
- Use Cloudflare's public STUN endpoint `stun:stun.cloudflare.com:3478` for
  ICE candidate discovery. It receives connectivity metadata only and never
  relays media.
- The UI announces available transmissions and lets each viewer start or stop
  watching independently.

### Explicitly Out of Scope

- LiveKit improvements, recording, Redis, and distributed presence.
- Mobile clients. Desktop automatic updates are tracked in Phase 13.

## Phase 11 - Linux Desktop Distribution

Phase 11 is complete. It extends the existing Windows and macOS release process
to Linux desktop users while retaining the same explicit, manually approved
release workflow.

### Delivered Configuration

- [x] Add a Linux runner to CI when desktop files change and to the manually
  approved desktop-release workflow.
- [x] Generate and publish the Linux desktop artifacts alongside the existing
  private GitHub Release assets.
- [x] Start with broadly compatible Linux packages: an AppImage and a Debian
  package (`.deb`).
- [x] Produce SHA-256 checksum files for each Linux artifact, as for the current
  Windows and macOS installers.

### Verification

- [x] Run the CI Linux packaging job and inspect its AppImage and `.deb`
  artifacts.
- [x] Run a manually approved desktop release and confirm the Linux assets and
  checksums are attached to the private GitHub Release.
- [x] Validate installation and launch on Pop!_OS.
- [x] Document installation, launch, update, and uninstall steps on Pop!_OS.

### Approved Decisions

- The first Linux release supports `x64` only. ARM64 will be added only when
  there is a real user need.
- Unsigned AppImage and `.deb` packages are accepted for the private initial
  distribution. Users must verify the published SHA-256 checksum before use.

### Explicitly Out of Scope

- Automatic in-app updates are delivered separately in Phase 13.
- Distribution through Snap Store, Flathub, or other public package stores.
- Mobile clients.

## Phase 12 - Frontend and Backend Boundary Review

Phase 12 begins only after the P2P media migration has been validated. Its
purpose is to verify whether the current Electron/Angular and Go boundaries
remain appropriate as the application evolves.

### Proposed Scope

- Audit the responsibilities of the Angular renderer, Electron main/preload
  boundary, Go API, WebSocket signaling, and PostgreSQL access.
- Confirm that the renderer continues to have no direct access to credentials,
  database connections, or Node.js capabilities.
- Identify only concrete coupling that impairs testing, independent release,
  or maintainability; avoid a structural split merely for its own sake.
- Produce an approved migration plan if changes are justified, preserving the
  pnpm monorepo unless a separate repository provides a demonstrated benefit.

### Explicitly Out of Scope

- Splitting the system into microservices.
- Replacing the Go backend or Angular/Electron desktop stack without a
  validated technical reason.

## Phase 13 - Desktop Automatic Updates

Phase 13 implements the application and release-pipeline pieces for background
desktop updates. Windows NSIS is the first supported runtime path. Production
activation is pending a publicly readable release feed and a packaged
old-version-to-new-version acceptance test.

### Implemented - Pending Acceptance

- [x] Add `electron-updater` as a runtime dependency and isolate update logic
  from the Electron bootstrap.
- [x] Keep update checks disabled in development and schedule conservative
  automatic checks only for packaged applications.
- [x] Download in the background, expose typed status through preload IPC, and
  let the user restart immediately or defer installation.
- [x] Add a discrete Angular update notice without exposing Node.js or provider
  credentials to the renderer.
- [x] Preserve `latest*.yml`, blockmaps, and macOS ZIP payloads in the manually
  approved release workflow.
- [x] Document versioning, release assets, signing, provider security, and
  platform-specific constraints.

### Required Before Production Activation

- [ ] Host release manifests and payloads on a publicly readable GitHub or
  generic HTTPS feed; never embed a private GitHub token in the application.
- [ ] Install an older Windows release, publish a higher version, and validate
  background download, deferral, restart, installation, and relaunch.
- [ ] Configure a stable Windows code-signing identity in CI to remove the
  unknown-publisher distribution risk.

### Deferred Platform Acceptance

- [ ] Sign and notarize macOS builds with a consistent identity before enabling
  production macOS automatic updates.
- [ ] Validate AppImage updates on the supported Linux distribution; continue
  managing `.deb` updates through the package manager until then.

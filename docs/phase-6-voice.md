# Phase 6 — Voice Channels

## Objective

Enable authenticated server members to join a voice channel from the desktop
application using a self-hosted LiveKit instance.

## Architecture

- PostgreSQL continues to store only servers, memberships, and channel type.
  It does not store LiveKit tokens or media-session state.
- The Go API authorizes the caller against `server_memberships`, verifies that
  the selected channel has type `voice`, and signs a short-lived LiveKit token.
- The Electron main process obtains the token through authenticated IPC; the
  Angular renderer receives only the LiveKit URL and short-lived token needed
  to connect.
- Audio flows directly between the desktop client and LiveKit over WebRTC. The
  Go API does not proxy media.

## Local Development

`docker compose up -d` starts PostgreSQL and LiveKit. The Compose LiveKit
service uses `--dev` and the `devkey`/`secret` credentials in `.env.example`.
They are strictly local-development values and must be replaced by managed
secrets and a production LiveKit configuration when deploying remotely.

Create a voice channel from the desktop owner menu, or run `Create Voice
Channel` followed by `Create Voice Token` in the Postman collection. With the
API and desktop app running, select the voice channel; the app requests the
microphone and joins automatically. Use the `Sair de <canal>` button to leave.

## Scope and Limits

- Delivered: voice-channel type, membership-gated LiveKit token issuance,
  local LiveKit Compose service, desktop microphone publishing, and remote
  audio playback.
- Transferred to and completed in Phase 7: mute UI, voice-participant display,
  active-speaker indication, and server-member presence.
- Transferred to and completed in Phase 9: camera publishing, screen sharing,
  optional system-audio sharing on Windows, and the media-stage desktop UI.
- Deliberately deferred: device selection, recording, TURN configuration, and
  multi-instance operational infrastructure.

## Supersession

LiveKit remains the implementation for voice during and after the in-progress
Phase 10 migration. Only camera and screen-share transmissions move to direct
WebRTC P2P with authenticated WebSocket signaling and opt-in reception. No
additional LiveKit video or screen-sharing features should be added.

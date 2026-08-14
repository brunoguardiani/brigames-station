# Phase 5 - Realtime Text Delivery

## Objective

Deliver newly created channel messages to connected, authorized desktop
clients without polling, while retaining HTTP as the source of truth for
message history.

## Scope

- `GET /ws` upgrades to a WebSocket connection.
- The client sends one initial `authenticate` message containing a short-lived
  access token. The server validates it before registering the connection.
- The server emits `message.created` with the same message shape returned by
  the HTTP create operation.
- A message event is delivered only to current members of that channel's
  server, including the author when connected.
- The Electron main process owns the WebSocket and forwards only typed domain
  events through the preload API. Angular never receives an access token.
- Reconnection uses 1, 2, 4, 8, 16, then at most 30-second delays. After an
  authenticated reconnect, Angular reloads the selected channel through HTTP.

## Security and Operations

- WebSocket origin verification is enabled by the server library: cross-origin
  browser requests are rejected unless their origin matches the request host.
  Electron's main-process connection does not need an `Origin` header.
- The initial client message is limited to 4 KiB and must be the authentication
  message. The server accepts no application commands through WebSocket in this
  phase.
- Production traffic must use WSS behind the TLS reverse proxy. Do not log
  tokens or message contents.

## Explicitly Out of Scope

- Presence, typing, reactions, read receipts, notifications, and offline
  queues.
- Redis, cross-instance event propagation, and more than one Go API instance.
- Voice, video, screen sharing, LiveKit, and WebRTC.

## Acceptance Criteria

- A connected server member receives a `message.created` event after another
  member creates a message in a channel they both can access.
- A non-member never receives that channel's events.
- A reconnecting desktop client reloads its selected channel after WebSocket
  authentication completes.
- No token is exposed to the Angular renderer.

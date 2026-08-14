# Phase 2: Servers and Channels

## Objective

Introduce the minimum collaborative structure for authenticated users: servers,
server membership, and text channels. This phase establishes authorization
boundaries for future messages without introducing realtime features.

## Approved Scope

- Any authenticated user may create a server.
- A server creator becomes its first server-level `owner`.
- A server has `owner` and `member` roles. These roles are scoped to the
  server and are independent from the global identity role.
- Every new server receives one text channel named `general`.
- Members may leave a server. The last server owner may not leave.
- This phase supports only `text` channels.
- Server and channel lists are available in the authenticated desktop shell.

## Explicitly Out of Scope

- Messages, threads, reactions, attachments, and search.
- Invitations and server discovery.
- WebSocket, presence, notifications, and automatic reconnection.
- Voice channels, LiveKit, WebRTC, camera, microphone, and screen sharing.
- Fine-grained per-channel permissions, moderation, or server deletion.

## Data Model

- `servers`: identifier, name, optional description, creator identifier, and
  timestamps.
- `server_memberships`: server identifier, user identifier, role (`owner` or
  `member`), and timestamps. A user may have at most one membership per
  server.
- `channels`: identifier, server identifier, name, type (`text`), position,
  creator identifier, and timestamps.

Foreign keys enforce server ownership, membership, and channel containment.
The initial server creation transaction creates the server, its owner
membership, and the `general` channel atomically.

## Authorization Rules

- Any authenticated user can create and list their own servers.
- A user may view a server and its channels only when they are a member.
- A server `owner` can create channels.
- A `member` can list the server and channels and may leave the server.
- The final `owner` membership cannot be removed or leave the server.

## HTTP Contract

OpenAPI remains the source of truth. Before backend implementation, add
contracts for:

- `GET /servers`: list servers for the authenticated user.
- `POST /servers`: create a server and its default `general` channel.
- `GET /servers/{serverId}`: retrieve a server visible to the member.
- `GET /servers/{serverId}/channels`: list channels visible to the member.
- `POST /servers/{serverId}/channels`: create a text channel as server owner.
- `POST /servers/{serverId}/leave`: leave a server when permitted.

Membership-management endpoints are deferred until their user experience and
invitation policy are defined. The initial phase proves the authorization model
through creator ownership and safe member departure.

## Desktop Boundary

The Electron main process continues to own authentication and access tokens.
The preload exposes only explicit operations needed by the renderer for
server and channel listing and creation, plus leaving a server. The Angular
renderer does not receive raw tokens or Node APIs.

## Implementation Order

1. Extend OpenAPI with the approved server and channel contracts.
2. Add versioned SQL migrations for servers, memberships, and channels.
3. Implement server and channel services, transaction boundaries, and
   membership authorization with unit and integration tests.
4. Implement Gin handlers and update the Postman collection.
5. Extend the Electron preload API and its TypeScript declarations.
6. Implement the Angular authenticated server-and-channel view.
7. Validate server creation, default channel creation, authorized listing,
   owner-only channel creation, member departure, and cross-server access
   denial end to end.

## Acceptance Criteria

- A signed-in user can create a server and receives an owner membership.
- Server creation atomically creates exactly one `general` text channel.
- A user can access only servers and channels for which they have a
  membership.
- A non-owner cannot create a channel.
- A member can leave a server; the last server owner cannot leave it.
- The desktop shows the authenticated user's servers and selected server
  channels without exposing raw tokens to Angular.

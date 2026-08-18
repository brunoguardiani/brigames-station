# Phase 1: Identity and Access

## Objective

Introduce the minimum identity layer needed to associate future servers,
channels, and messages with authenticated users.

## Approved Direction

- User accounts with unique username, email, and password.
- Account creation enabled only by a local configuration flag.
- Short-lived JWT access tokens and opaque refresh tokens.
- Global `owner` and `member` roles, normalized in a `roles` table.
- A secure owner-bootstrap command, never a credential in a migration.
- Desktop login screen and authenticated application shell.

## Explicitly Out of Scope

- OAuth or external identity providers.
- Password reset or email verification.
- Multi-factor authentication.
- Server-specific roles, permissions, and invitations.
- WebSocket authentication and realtime presence.

## Architecture

### Authentication model

Use username or email plus password authentication. Each account has both a
unique username and email; either can identify the account at login. Passwords
are hashed with Argon2id; plaintext passwords are never logged or persisted.

Use a short-lived JWT access token and an opaque refresh token. The JWT is
signed with a single server-side key and contains only `sub`, `jti`, `iat`,
`exp`, `iss`, and `aud`. Access tokens expire after 15 minutes and are sent
using `Authorization: Bearer`.

The refresh token is cryptographically random. PostgreSQL stores only its hash
and rotates it when issuing a new access token. Refresh tokens expire after 30
days; logout revokes them. This permits revocation without Redis or distributed
state.

The backend reads `AUTH_REGISTRATION_ENABLED`, `AUTH_JWT_SECRET`,
`AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_ACCESS_TOKEN_TTL`, and
`AUTH_REFRESH_TOKEN_TTL` from its environment. The JWT secret is required and
must contain at least 32 bytes. Local registration defaults to disabled.

### Data model

- `roles`: global role catalog. It initially contains only `owner` and
  `member`.
- `users`: identifier, unique username, unique email, Argon2id password hash,
  one required `role_id`, and timestamps. `roles → users` is one-to-many: each
  account has one global role in Phase 1.
- `refresh_tokens`: identifier, user identifier, token hash, expiry, revocation
  and timestamps.

Fine-grained permissions are intentionally deferred. If they become necessary,
the next model is `roles ↔ permissions` through `role_permissions`; users do
not need to change for that addition.

Migrations create only schema. An explicit `seed-owner` command creates the
first owner from `OWNER_USERNAME`, `OWNER_EMAIL`, and `OWNER_PASSWORD`
environment variables. It refuses to run when an owner already exists. No
password or password hash is committed to source control; remove
`OWNER_PASSWORD` from the local environment after successful bootstrap.

### Desktop boundary

The renderer never receives Node APIs or raw tokens. The Electron main process
owns token storage and exposes narrow preload methods for login, logout,
refresh, and current-session state. It renews the short-lived access token in
the background before expiry, retries one authenticated request after a 401,
and refreshes before reconnecting the realtime WebSocket.

## HTTP Contract Proposal

- `POST /auth/register`: create an account when registration is enabled.
- `POST /auth/login`: authenticate credentials and issue tokens.
- `POST /auth/refresh`: exchange a valid refresh token for new tokens.
- `POST /auth/logout`: revoke the current refresh token.
- `GET /me`: return the authenticated user.

All response bodies and error cases must be added to OpenAPI before backend
implementation.

## Implementation Order

1. Approve the remaining product decisions below.
2. Extend OpenAPI with authentication and current-user contracts.
3. Add versioned SQL migrations for `users` and `refresh_tokens`.
4. Implement password hashing, JWT issuance and validation, refresh-token
   rotation, `seed-owner`, and authentication middleware.
5. Implement register, login, refresh, logout, and `GET /me` with tests.
6. Extend the Electron preload boundary for explicit auth operations.
7. Implement Angular login and authenticated shell.
8. Validate login, refresh after restart, logout, invalid credentials, and
   revoked/expired tokens end to end.

## Approved Product Decisions

- Registration is enabled only while a local configuration flag is true.
- Each account requires both username and email; login accepts either field.

## Acceptance Criteria

- Credentials are never stored or logged in plaintext.
- Protected endpoints reject missing, invalid, expired, and revoked tokens.
- Login survives a desktop restart through refresh-token rotation until expiry
  or revocation.
- An active desktop session renews its access token without requiring a user
  logout/login while the refresh token remains valid.
- Logout revokes the refresh token and returns the desktop to the login screen.
- Neither access nor refresh token is directly exposed to the Angular renderer.

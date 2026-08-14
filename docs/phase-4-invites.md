# Phase 4: Temporary Server Invites

Server owners create a cryptographically random invite code. Its raw value is
returned only once, its SHA-256 hash is stored in PostgreSQL, and it expires
exactly 24 hours after creation. It has unlimited uses until expiry or owner
revocation. An authenticated user joins as `member`; joining again is
idempotent and does not create a duplicate membership.

Endpoints: `POST /servers/{serverId}/invites`, `POST /invites/{code}/join`,
and `POST /servers/{serverId}/invites/{inviteId}/revoke`. Invites, discovery,
and public servers remain out of scope.

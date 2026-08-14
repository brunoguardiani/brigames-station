# Phase 3: Text Messages

Phase 3 makes text channels usable with persistent HTTP messages. A member may
create and list messages only in channels of servers they belong to. Messages
are immutable, trimmed, and limited to 1–4,000 characters. Lists use an
optional `before` message ID cursor, default to 50 results, and never exceed
100 results.

This phase excludes editing, deletion, attachments, reactions, threads,
search, WebSocket, typing state, notifications, and all other realtime
behavior. Electron continues to keep tokens in its main process; Angular gets
only typed message data through the preload boundary.

Acceptance requires authorized create/list behavior, cross-server denial,
cursor pagination, and an Electron view that displays and sends messages.

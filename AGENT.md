# Project Context

This is a personal Discord-like desktop application.

Users:
- Maximum ~15 concurrent users.
- Personal use with friends.

Architecture:
- Desktop: Electron + Angular
- Backend: Go
- Database: PostgreSQL
- Realtime: WebSocket
- Voice/video: LiveKit initially
- Deployment: Docker Compose

Important architectural rule:
- Go is the control plane.
- LiveKit is the media plane.
- Do not implement WebRTC/SFU from scratch unless explicitly requested.

Development principles:
- Avoid premature microservices.
- Prefer a modular monolith.
- Keep infrastructure simple.
- Optimize for maintainability and learning.
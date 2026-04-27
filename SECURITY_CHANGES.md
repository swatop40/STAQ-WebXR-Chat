# Security Changes

This branch adds targeted hardening for public hosting without changing the project architecture.

## Server-side

File: `server/server.js`

- Added environment-aware CORS.
- Added safer response headers and removed `x-powered-by`.
- Added `/api/health` for deployment checks.
- Added generic client-facing error responses instead of leaking internals.
- Moved player trust to server-owned socket state.
- Validated and clamped incoming pose/avatar data.
- Added rate limits for:
  - `pose`
  - `webrtc-offer`
  - `webrtc-answer`
  - `webrtc-ice-candidate`
  - `chat-message`
  - `scene-state-update`
  - `tv-debug-message`
- Restricted WebRTC signaling to valid connected targets in the same room.
- Preserved exact SDP and ICE strings so WebRTC parsing still works.

## Client-side

File: `src/main.js`

- Added name sanitization for app startup.
- Added known-peer tracking so the client only accepts signaling from expected users.
- Hid debug/error detail in production builds.
- Kept the local avatar updating even if the socket is not yet connected.
- Preserved desktop held-object hand-follow behavior.

## Entry pages

Files: `index.html`, `choose-scene.html`

- Added input sanitization before storing/passing player names.

## Deployment hygiene

Files: `.gitignore`, `package.json`, `.env.example`, `HOSTING.md`

- Added safer ignore rules for `.env`, certs, and coverage output.
- Added `start` script and hosted `preview`.
- Added example environment variables and HTTPS/reverse-proxy notes.

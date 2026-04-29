# DigitalOcean Hosting Notes

## Recommended DigitalOcean target

This repo is ready for DigitalOcean App Platform as a single web service:

- Vite builds the frontend into `dist/`
- Express serves the built frontend plus the Socket.IO and API routes
- The app listens on `PORT` and `0.0.0.0`
- A health check is available at `/healthz`

That is the cleanest first deployment path for the current project because DigitalOcean can build directly from this repo's root `Dockerfile`.

## What is already prepared in this repo

- `Dockerfile`: multi-stage Node build for production
- `server/server.js`: serves `dist`, exposes `/healthz`, and reads `PORT`
- `vite.config.js`: keeps both `index.html` and `choose-scene.html` in the production build
- `.do/app.yaml`: starter App Platform spec for this repo

## Local container test

The repo still includes a local HTTPS proxy using Caddy for LAN and headset-friendly testing:

```powershell
docker compose up --build
```

Then open:

- `https://localhost/`
- `https://localhost/choose-scene.html`
- `https://localhost/healthz`

Notes:

- The app container listens on plain HTTP internally at port `3000`
- Local `docker-compose.yml` is for local HTTPS testing and is not required by App Platform
- App Platform terminates TLS for you, so Caddy is not part of the managed deployment path

## App Platform deployment

### Option A: Deploy from GitHub in the control panel

1. Push the repo to GitHub.
2. In DigitalOcean, create a new App Platform app.
3. Choose GitHub as the source and select `swatop40/STAQ-WebXR-Chat`.
4. Keep the root `Dockerfile` deployment mode.
5. Set the web service HTTP port to `3000`.
6. Set the health check path to `/healthz`.
7. Add runtime environment variables:
   - `NODE_ENV=production`
   - `CORS_ORIGIN=https://your-app-domain`
8. Deploy.

### Option B: Deploy with the included app spec

This repo now includes `.do/app.yaml`.

After reviewing the app name, region, branch, and `CORS_ORIGIN`, create the app with:

```powershell
doctl apps create --spec .do/app.yaml
```

Useful follow-up command after edits:

```powershell
doctl apps update <app-id> --spec .do/app.yaml
```

## Environment variables

- `PORT`: HTTP port for the Node server. On App Platform this should stay `3000` in the spec.
- `CORS_ORIGIN`: Allowed browser origin for API and Socket.IO.
  This can now be a single origin like `https://your-app.ondigitalocean.app` or a comma-separated list like `https://your-app.ondigitalocean.app,https://yourdomain.com`.
- `NODE_ENV`: Set to `production`
- `STUN_URLS`: Comma-separated STUN URLs. Default starter value: `stun:stun.l.google.com:19302`
- `TURN_URLS`: Comma-separated TURN URLs such as `turn:turn.st-aq.com:3478?transport=udp,turn:turn.st-aq.com:3478?transport=tcp`
- `TURN_USERNAME`: TURN username
- `TURN_CREDENTIAL`: TURN password or static credential
- `TURN_CREDENTIAL_TYPE`: Optional. Usually leave unset unless your TURN provider requires it.
- `WEBRTC_ICE_SERVERS`: Optional JSON array override if you want full manual control over the browser ICE config instead of the simpler `STUN_URLS` and `TURN_*` env vars

The app now exposes `/api/webrtc-config` from the Node server and the browser reads ICE config from that endpoint at runtime. That means you can update TURN/STUN settings with environment variables without rebuilding the frontend bundle.

## Why App Platform works for this project

- The app is already structured as one containerized Node service
- Socket.IO rides over the same HTTP(S) origin as the site
- DigitalOcean can build directly from the root `Dockerfile`
- The app already has a health endpoint for readiness checks

## When to choose a Droplet instead

App Platform is a strong fit for the current stack, but a Droplet becomes the better choice if you want:

- your own reverse proxy and deeper networking control
- a co-located TURN server for stricter WebRTC environments
- more custom background services than App Platform's single web-service path

If voice reliability becomes the next big production issue, a Droplet plus `coturn` is the likely next step.

## Voice chat reliability

If voice works for some users but fails one-way for others, the usual cause is STUN-only WebRTC on mixed home/mobile/headset networks.

This repo now supports both:

- STUN-only fallback for local testing and light usage
- TURN + STUN for more reliable production voice

### App Platform plus TURN

The recommended production shape is:

1. Keep the main app on DigitalOcean App Platform.
2. Run a small TURN server on a DigitalOcean Droplet using `coturn`.
3. Point a subdomain such as `turn.st-aq.com` at that Droplet in Cloudflare.
4. Add App Platform runtime variables:
   - `STUN_URLS=stun:stun.l.google.com:19302`
   - `TURN_URLS=turn:turn.st-aq.com:3478?transport=udp,turn:turn.st-aq.com:3478?transport=tcp`
   - `TURN_USERNAME=<your-turn-username>`
   - `TURN_CREDENTIAL=<your-turn-password>`

### If you want one JSON env var instead

Set `WEBRTC_ICE_SERVERS` to a JSON array like this:

```json
[
  { "urls": "stun:stun.l.google.com:19302" },
  {
    "urls": [
      "turn:turn.st-aq.com:3478?transport=udp",
      "turn:turn.st-aq.com:3478?transport=tcp"
    ],
    "username": "your-turn-username",
    "credential": "your-turn-password"
  }
]
```

### Domain notes

- `st-aq.com` should keep pointing at the main App Platform app
- `turn.st-aq.com` is a good dedicated hostname for the TURN server
- Cloudflare DNS is fine for this layout

### Next practical step

If you want reliable headset/desktop voice for a wider set of networks, the next move is setting up `coturn` on a tiny Droplet and pointing `turn.st-aq.com` at it.

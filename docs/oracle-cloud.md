# Oracle Cloud Hosting Notes

## Current deployment shape

This project can now run as a single Node container:

- Vite builds the frontend into `dist/`
- Express serves the built frontend and the Socket.IO/API endpoints
- The app listens on `PORT` and `0.0.0.0` for container hosting
- A health check is available at `/healthz`

## Local container test

The repo now includes a local HTTPS proxy using Caddy so browser and WebXR testing can start on TLS immediately.

Build and run:

```powershell
docker compose up --build
```

Then open:

- `https://localhost/`
- `https://192.168.0.17/`
- `https://localhost/choose-scene.html`
- `https://localhost/healthz`

Notes:

- The app container still listens on plain HTTP internally at port `3000`
- Caddy terminates HTTPS and proxies requests to the app container
- Caddy generates and stores a local development CA inside its Docker volume
- For Quest or other standalone headsets, device trust will still usually require installing the local CA or moving to a real hosted domain with a public certificate

## Oracle Cloud shape

For a first live deployment on an Oracle Cloud Compute instance:

1. Install Docker on the VM.
2. Copy the repo to the VM.
3. Run `docker compose up -d --build`.
4. Open TCP port `3000` in the Oracle Cloud security list or network security group.
5. Point your domain at the VM.

## Recommended next step for production

Put a reverse proxy with TLS in front of this container.

Why:

- WebXR is happiest on HTTPS
- WebRTC also benefits from a real public HTTPS origin
- It gives you cleaner domain handling and future room for compression/caching

Two straightforward options:

- Run Caddy or Nginx on the VM in front of this container
- Put the app behind an Oracle load balancer that terminates TLS

## Environment variables

- `PORT`: HTTP port for the Node server. Default: `3000`
- `CORS_ORIGIN`: Allowed browser origin for API and Socket.IO. Default: `*`
- `NODE_ENV`: Set to `production` in the container

## WebRTC note

Voice chat currently uses Google's public STUN server only. That may be enough for some users, but a full public deployment often needs TURN as well for reliable voice across restrictive networks. When you are ready, we should add TURN server configuration as a follow-up.

# Hosting Notes

## Recommended production setup

1. Serve the built frontend and the Node server behind HTTPS.
2. Reverse proxy `/socket.io` and `/api` to the Node process on `PORT`.
3. Set `ALLOWED_ORIGINS` to the exact deployed frontend origin, such as `https://your-domain.example`.
4. Set `TRUST_PROXY=1` when running behind Nginx, Apache, Caddy, or a cloud load balancer.

## Environment variables

- `NODE_ENV=production`
- `PORT=3000`
- `ALLOWED_ORIGINS=https://your-domain.example`
- `TRUST_PROXY=1`

For local development, the server allows the default Vite localhost origins if `NODE_ENV` is not `production`.

## HTTPS and WebXR

- WebXR requires a secure context in normal browsers, so production should always use HTTPS.
- Local Vite HTTPS can continue using the existing mkcert setup for development.
- If you deploy the built frontend behind the same origin as the Node server, the current frontend code will keep using same-origin `/api` and `/socket.io` paths.

## Git hygiene

- Keep `.env`, private certificates, and build output out of git.
- Only commit `.env.example` with placeholder values.

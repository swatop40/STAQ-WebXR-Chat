import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  plugins: [mkcert()],
  server: {
    https: true,
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      // Proxy Socket.IO requests to your Node server
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true
      }
    }
  }
})

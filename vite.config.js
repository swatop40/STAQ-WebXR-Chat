import path from 'node:path'
import { defineConfig } from 'vite'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig(({ command }) => ({
  plugins: command === 'serve' ? [mkcert()] : [],
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
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        chooseScene: path.resolve(__dirname, 'choose-scene.html'),
      },
    },
  },
}))

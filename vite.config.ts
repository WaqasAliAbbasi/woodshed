import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Plain `npm run dev` is localhost-only, plain HTTP. `npm run dev:https`
// sets this to also bind to the LAN and switch on a self-signed cert, so
// the network address counts as a secure context — needed for Web MIDI
// (Chrome) and crypto.randomUUID when testing from another device.
const useHttps = process.env.HTTPS === 'true'

// `npm run dev` starts this alongside the backend (see package.json), on
// :3000 — proxy every backend-owned route there so the browser only ever
// talks to the Vite origin (relative `/api/*` fetches in src/lib/api/client.ts
// then resolve correctly, and the session cookie — which carries no
// explicit Domain attribute — sticks to that one origin). Only routes
// server/index.ts actually registers before the SPA fallback: everything
// else (assets, client-routed paths) stays with Vite.
const backendProxy = {
  target: 'http://localhost:3000',
  changeOrigin: true,
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), useHttps && basicSsl()],
  server: {
    host: useHttps,
    proxy: {
      '/api': backendProxy,
      '/login': backendProxy,
      '/signup': backendProxy,
      '/oauth': backendProxy,
      '/mcp': backendProxy,
      '/.well-known': backendProxy,
    },
  },
  test: {
    environment: 'jsdom',
  },
})

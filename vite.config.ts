import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Plain `npm run dev` is localhost-only, plain HTTP. `npm run dev:https`
// sets this to also bind to the LAN and switch on a self-signed cert, so
// the network address counts as a secure context — needed for Web MIDI
// (Chrome) and crypto.randomUUID when testing from another device.
const useHttps = process.env.HTTPS === 'true'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), useHttps && basicSsl()],
  server: {
    host: useHttps,
  },
  test: {
    environment: 'jsdom',
  },
})

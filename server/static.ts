import path from 'node:path'
import type { Express } from 'express'
import express from 'express'

/**
 * Reimplements the two behaviors the old `Caddyfile` gave this app for
 * free, now that a Node process serves the bundle instead of Caddy (see the
 * Dockerfile): hashed `/assets/*` cached hard since Vite fingerprints those
 * filenames, and — via `mountSpaFallback` below — any unmatched path
 * resolving to `index.html` instead of a 404, since this is a client-routed
 * SPA (see App.tsx's `/dashboard` check).
 *
 * Mounted *before* the API/MCP/OAuth/login routers, so a static file (an
 * icon, the manifest) is served without ever reaching auth middleware.
 */
export function mountStaticAssets(app: Express, distDir: string): void {
  app.use(
    '/assets',
    express.static(path.join(distDir, 'assets'), {
      immutable: true,
      maxAge: '1y',
    }),
  )
  app.use(express.static(distDir))
}

/**
 * Mounted *last*, after every other route — by the time a request reaches
 * this, it matched no static file and no API/MCP/OAuth/login route, so (per
 * the SPA-fallback contract) it's a client-side route like `/dashboard` and
 * gets `index.html`, letting React Router-less `App.tsx` sort out what to
 * render from `location.pathname` itself.
 */
export function mountSpaFallback(app: Express, distDir: string): void {
  app.use((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

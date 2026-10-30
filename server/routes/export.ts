import type { DatabaseSync } from 'node:sqlite'
import express, { type Router } from 'express'
import { requireExportKey } from '../auth/exportKey.ts'
import { createExportKey } from '../auth/exportKey.ts'
import { getUserId, resolveSessionUserId } from '../auth/session.ts'
import * as queries from '../queries.ts'

/**
 * Read-only export for the user's other apps (life's weekly note). Auth is an export key, not the login cookie, so
 * this router is mounted before the cookie guard in index.ts. Only what a weekly count needs: when, how long, the
 * piece titles. Not the session's note, and never attempts or scores.
 */
export function createExportRouter(db: DatabaseSync): Router {
  const router = express.Router()
  router.get('/api/export/sessions', requireExportKey(db), (req, res) => {
    const since = req.query.since !== undefined ? Number(req.query.since) : undefined
    if (since !== undefined && !Number.isFinite(since)) {
      res.status(400).json({ error: 'since must be a numeric epoch-ms timestamp' })
      return
    }
    const userId = getUserId(req)
    res.json({ sessions: queries.exportSessions(db, userId, since) })
  })

  // A page for minting a key while logged in (instead of a shell on the box): the cookie decides whose key it is.
  // Make a key per app and delete none: a key only ever reads this user's session times and piece titles.
  const page = (body: string) => `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Export key — Woodshed</title>
<style>
  :root { color-scheme: light dark; --text: #26201a; --bg: #f6ecd9; --surface: #ecdbb8; --border: #d8c297; --accent: #b8792e; --accent-text: #fff8ec; --muted: #6e5b40; }
  @media (prefers-color-scheme: dark) { :root { --text: #efe3cc; --bg: #1c1712; --surface: #2a2015; --border: #40331f; --accent: #d79a4c; --accent-text: #241705; --muted: #b3a186; } }
  body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 1.5rem; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  .card { max-width: 420px; width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; }
  h1 { font-size: 1.2rem; margin: 0 0 .75rem; } p { line-height: 1.4; } .muted { color: var(--muted); font-size: .85rem; }
  code { display: block; word-break: break-all; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: .6rem; user-select: all; }
  button { width: 100%; padding: .65rem; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-text); font-size: 1rem; cursor: pointer; }
</style></head><body><div class="card">${body}</div></body></html>`

  router.get('/export-key', (req, res) => {
    if (!resolveSessionUserId(db, req)) {
      res.redirect(302, `/login?next=${encodeURIComponent('/export-key')}`)
      return
    }
    res.send(
      page(`<h1>Export key</h1>
<p>A read-only key that lets your other apps (your life server) read when you practised and which pieces: not your notes, attempts or scores.</p>
<form method="POST" action="/export-key"><button type="submit">Make a new key</button></form>
<p class="muted">The key is shown once. Making another does not cancel earlier ones.</p>`),
    )
  })

  // SameSite=Lax session cookie: a POST from another site doesn't carry it, so only this page can make a key.
  router.post('/export-key', (req, res) => {
    const userId = resolveSessionUserId(db, req)
    if (!userId) {
      res.redirect(303, `/login?next=${encodeURIComponent('/export-key')}`)
      return
    }
    const key = createExportKey(db, userId, 'page')
    res.set('Cache-Control', 'no-store').send(
      page(`<h1>Your export key</h1><code>${key}</code><p class="muted">Copy it now: it is not shown again (only a hash is stored).</p>`),
    )
  })
  return router
}

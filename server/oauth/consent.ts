import type { DatabaseSync } from 'node:sqlite'
import express, { type Router } from 'express'
import { resolveSessionUserId } from '../auth/session.ts'
import { createClientsStore } from './clientsStore.ts'
import { consumeTransaction, getTransaction, issueAuthorizationCode } from './provider.ts'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function page(body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Authorize — Woodshed</title>
<style>
  :root { --text: #26201a; --bg: #f6ecd9; --surface: #ecdbb8; --border: #d8c297; --accent: #b8792e; --accent-text: #fff8ec; --muted: #6e5b40; }
  @media (prefers-color-scheme: dark) {
    :root { --text: #efe3cc; --bg: #1c1712; --surface: #2a2015; --border: #40331f; --accent: #d79a4c; --accent-text: #241705; --muted: #b3a186; }
  }
  body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 1.5rem;
         display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  .card { max-width: 380px; width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; }
  h1 { font-size: 1.2rem; margin: 0 0 0.75rem; }
  p { line-height: 1.4; }
  .as { color: var(--muted); font-size: 0.85rem; }
  .actions { display: flex; gap: 0.6rem; margin-top: 1.25rem; }
  button { flex: 1; padding: 0.6rem; border-radius: 8px; border: 1px solid var(--border); font-size: 1rem; cursor: pointer; }
  .allow { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  .deny { background: transparent; color: var(--text); }
</style>
</head>
<body>${body}</body>
</html>`
}

/**
 * `/oauth/consent` — where `provider.authorize()` redirects an incoming MCP
 * /authorize request (see provider.ts's doc comment for why: that method
 * only gets `res`, not `req`, so it can't check the session cookie or know
 * which user is asking). This route does see the request, so it can gate on
 * login and, once approved, issue an authorization code bound to *that*
 * logged-in user's id — the point in this whole flow where "which of this
 * server's users is this" first gets decided, in a multi-user instance
 * (see schema.sql's `users` table).
 */
export function createConsentRouter(db: DatabaseSync): Router {
  const router = express.Router()
  const clientsStore = createClientsStore(db)

  router.get('/oauth/consent', async (req, res) => {
    const txnId = typeof req.query.txn === 'string' ? req.query.txn : undefined
    if (!txnId) {
      res.status(400).send(page('<div class="card"><h1>Missing request</h1><p>No authorization request was found.</p></div>'))
      return
    }
    const userId = resolveSessionUserId(db, req)
    if (!userId) {
      res.redirect(302, `/login?next=${encodeURIComponent(`/oauth/consent?txn=${txnId}`)}`)
      return
    }
    const txn = getTransaction(db, txnId)
    if (!txn) {
      res
        .status(400)
        .send(page('<div class="card"><h1>Request expired</h1><p>Go back to Claude and try connecting again.</p></div>'))
      return
    }
    // The store interface's return type allows a Promise even though this
    // implementation (clientsStore.ts) is synchronous — await either way.
    const client = await clientsStore.getClient(txn.clientId)
    const clientName = escapeHtml(client?.client_name ?? 'This application')
    res.send(
      page(`
      <div class="card">
        <h1>Authorize ${clientName}</h1>
        <p>${clientName} wants to read your Woodshed practice history — pieces, sections, and attempt results.</p>
        <form method="POST" action="/oauth/consent/approve">
          <input type="hidden" name="txn" value="${escapeHtml(txnId)}" />
          <div class="actions">
            <button class="deny" formaction="/oauth/consent/deny">Deny</button>
            <button class="allow" type="submit">Allow</button>
          </div>
        </form>
      </div>`),
    )
  })

  router.use('/oauth/consent/approve', express.urlencoded({ extended: false }))
  router.use('/oauth/consent/deny', express.urlencoded({ extended: false }))

  router.post('/oauth/consent/approve', (req, res) => {
    const userId = resolveSessionUserId(db, req)
    if (!userId) {
      res.status(401).send(page('<div class="card"><h1>Not logged in</h1></div>'))
      return
    }
    const txnId = typeof req.body?.txn === 'string' ? req.body.txn : undefined
    const txn = txnId ? getTransaction(db, txnId) : undefined
    if (!txn) {
      res.status(400).send(page('<div class="card"><h1>Request expired</h1></div>'))
      return
    }
    const code = issueAuthorizationCode(db, userId, txn)
    consumeTransaction(db, txn.txnId)
    const redirect = new URL(txn.redirectUri)
    redirect.searchParams.set('code', code)
    if (txn.state) redirect.searchParams.set('state', txn.state)
    res.redirect(302, redirect.toString())
  })

  router.post('/oauth/consent/deny', (req, res) => {
    const txnId = typeof req.body?.txn === 'string' ? req.body.txn : undefined
    const txn = txnId ? getTransaction(db, txnId) : undefined
    if (!txn) {
      res.status(400).send(page('<div class="card"><h1>Request expired</h1></div>'))
      return
    }
    consumeTransaction(db, txn.txnId)
    const redirect = new URL(txn.redirectUri)
    redirect.searchParams.set('error', 'access_denied')
    if (txn.state) redirect.searchParams.set('state', txn.state)
    res.redirect(302, redirect.toString())
  })

  return router
}

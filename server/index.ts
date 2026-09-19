import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import {
  clearSessionCookie,
  createSession,
  createUser,
  destroySession,
  findUserByUsername,
  getSessionToken,
  requireSession,
  setSessionCookie,
  validateNewUser,
  verifyPassword,
} from './auth/session.ts'
import { openDb } from './db.ts'
import { loadEnv } from './env.ts'
import { createMcpRouter } from './mcp.ts'
import { createConsentRouter } from './oauth/consent.ts'
import { createOAuthProvider } from './oauth/provider.ts'
import { createAttemptsRouter } from './routes/attempts.ts'
import { createImportExportRouter } from './routes/importExport.ts'
import { createPiecesRouter } from './routes/pieces.ts'
import { createSectionsRouter } from './routes/sections.ts'
import { mountSpaFallback, mountStaticAssets } from './static.ts'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, '..', 'dist')

const env = loadEnv()
const db = openDb(env.dbPath)
const publicUrl = new URL(env.publicUrl)
const secureCookies = publicUrl.protocol === 'https:'

const app = express()
// One hop: Traefik. Without this, express-rate-limit (used inside the
// SDK's OAuth handlers) buckets every request under Traefik's IP instead
// of the real client's, and req.protocol would read 'http' behind TLS
// termination. Same reasoning as ynab-mcp's TRUST_PROXY=1 on this box.
app.set('trust proxy', 1)

// Static assets and the manifest/icons first, so they're served without
// ever reaching auth middleware — see static.ts's own doc comment.
mountStaticAssets(app, distDir)

// ---- Login and signup (session cookie) ----
//
// Multi-user (see schema.sql's `users` table). A username, not just a
// shared password, because more than one person can have an account on the
// same instance. Signup is open — anyone who reaches /signup can create an
// account (see validateNewUser/createUser in auth/session.ts for the only
// gatekeeping: a sane username/password shape, and rate limiting below) —
// so a fresh account still only ever sees its own empty library, never
// anyone else's (see queries.ts's userId scoping).

app.get('/login', (_req, res) => {
  res.sendFile(join(here, 'public/login.html'))
})

app.get('/signup', (_req, res) => {
  res.sendFile(join(here, 'public/signup.html'))
})

app.post('/api/login', express.json(), (req, res) => {
  const body = req.body as { username?: string; password?: string } | undefined
  const user = body?.username ? findUserByUsername(db, body.username) : undefined
  if (!user || !body?.password || !verifyPassword(body.password, user.passwordHash)) {
    res.status(401).json({ error: 'Wrong username or password' })
    return
  }
  const { token, expiresAt } = createSession(db, user.id)
  setSessionCookie(res, token, expiresAt, secureCookies)
  res.status(204).end()
})

// Stricter than general API traffic on purpose — account creation is the
// one endpoint on this whole server an anonymous caller can hit at all.
// `app.set('trust proxy', 1)` above means this keys on the real client IP
// behind Traefik, not Traefik's own.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many accounts created from this address — try again later.' },
})

app.post('/api/signup', signupLimiter, express.json(), (req, res) => {
  const body = req.body as { username?: string; password?: string } | undefined
  const username = body?.username?.trim()
  const password = body?.password
  if (!username || !password) {
    res.status(400).json({ error: 'username and password are required' })
    return
  }
  const validationError = validateNewUser(username, password)
  if (validationError) {
    res.status(400).json({ error: validationError })
    return
  }
  const user = createUser(db, username, password)
  if (!user) {
    res.status(409).json({ error: 'That username is already taken' })
    return
  }
  // Sign the new account straight in — a separate "now log in" step after
  // signup is friction with no real safety benefit here (there's no email
  // to verify).
  const { token, expiresAt } = createSession(db, user.id)
  setSessionCookie(res, token, expiresAt, secureCookies)
  res.status(201).json({ username: user.username })
})

app.post('/api/logout', (req, res) => {
  const token = getSessionToken(req)
  if (token) destroySession(db, token)
  clearSessionCookie(res, secureCookies)
  res.status(204).end()
})

// ---- App API — every /api/* route below this line requires a session ----

app.use('/api', express.json({ limit: '15mb' }), requireSession(db))
app.use(createPiecesRouter(db))
app.use(createSectionsRouter(db))
app.use(createAttemptsRouter(db))
app.use(createImportExportRouter(db))

// ---- MCP: OAuth 2.1 authorization server + the /mcp endpoint itself ----
//
// This app *is* the authorization server (mcpAuthRouter), not just a
// resource server pointed at someone else's — see oauth/provider.ts. It
// installs /authorize, /token, /register, /revoke, and the two
// .well-known metadata documents; the actual login/consent screen those
// redirect to is createConsentRouter, reusing the same session cookie as
// the app itself (see consent.ts's doc comment for why /authorize can't
// check that cookie, or which user it belongs to, directly).

const oauthProvider = createOAuthProvider(db)

app.use(
  mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: publicUrl,
    resourceServerUrl: new URL('/mcp', publicUrl),
    resourceName: 'Woodshed',
    scopesSupported: ['woodshed:read'],
  }),
)
app.use(createConsentRouter(db))
app.use(createMcpRouter(db, oauthProvider))

// ---- SPA fallback — must be last; see static.ts's doc comment ----

mountSpaFallback(app, distDir)

const server = app.listen(env.port, () => {
  console.log(`woodshed listening on :${env.port} (${env.isProduction ? 'production' : 'development'})`)
})

// Docker sends SIGTERM on `docker compose down`/a redeploy — close the
// listener and the DB handle cleanly instead of relying on the process
// being killed out from under an in-flight SQLite write.
process.on('SIGTERM', () => {
  server.close(() => {
    db.close()
    process.exit(0)
  })
})

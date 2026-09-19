import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { NextFunction, Request, Response } from 'express'
import { generateId } from '../../src/lib/id.ts'

export const SESSION_COOKIE_NAME = 'woodshed_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const SCRYPT_KEYLEN = 64

// Every authenticated route reads the logged-in user off `req.userId` —
// set by `requireSession` below — instead of threading it through every
// function call by hand. Same pattern the MCP SDK itself uses for
// `req.auth` (see server/auth/middleware/bearerAuth.d.ts).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string
    }
  }
}

/**
 * Produces the `salt:hash` string stored in `users.password_hash` — called
 * by `createUser` below, whether that's reached through the public
 * `/api/signup` route or `scripts/createUser.ts`'s command-line path.
 * scrypt over bcrypt/argon2 so there's no native addon to compile —
 * `node:crypto` is always there, same reasoning as picking `node:sqlite`
 * over `better-sqlite3` (see db.ts).
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(':')
  if (!salt || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  // Buffers being compared must be equal length or timingSafeEqual throws —
  // guard rather than let a malformed hash 500 every login.
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export interface UserRecord {
  id: string
  username: string
  passwordHash: string
}

export function findUserByUsername(db: DatabaseSync, username: string): UserRecord | undefined {
  const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as unknown as
    | { id: string; username: string; password_hash: string }
    | undefined
  return row ? { id: row.id, username: row.username, passwordHash: row.password_hash } : undefined
}

/** Enforced by both `/api/signup` and `scripts/createUser.ts` (via `validateNewUser` below) — short enough to type on a phone, restrictive enough that a username is safe to use unescaped anywhere it might ever be displayed. */
const USERNAME_PATTERN = /^[a-zA-Z0-9_-]{3,32}$/
const MIN_PASSWORD_LENGTH = 8

/** Returns an error message if `username`/`password` don't meet the baseline (checked before ever touching the database), else undefined. Open signup (see index.ts's `/api/signup`) is a deliberate choice to let anyone create an account — it is not a license to skip basic input hygiene. */
export function validateNewUser(username: string, password: string): string | undefined {
  if (!USERNAME_PATTERN.test(username)) {
    return 'Username must be 3-32 characters: letters, numbers, underscore, or hyphen only.'
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  return undefined
}

/**
 * Shared by `/api/signup` and `scripts/createUser.ts`, so there's exactly
 * one code path that ever inserts a `users` row. Returns `undefined` if the
 * username is already taken (checked, then relied on the `UNIQUE`
 * constraint in schema.sql to catch a concurrent-signup race the
 * pre-check can't) rather than throwing — a taken username is an expected,
 * user-facing outcome, not a server error.
 */
export function createUser(db: DatabaseSync, username: string, password: string): UserRecord | undefined {
  if (findUserByUsername(db, username)) return undefined
  const user: UserRecord = { id: generateId(), username, passwordHash: hashPassword(password) }
  try {
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      user.id,
      user.username,
      user.passwordHash,
      Date.now(),
    )
  } catch {
    // Lost the race with a concurrent signup for the same username between
    // the check above and this insert — schema.sql's UNIQUE constraint is
    // the actual guarantee; the pre-check is just the common-case fast path.
    return undefined
  }
  return user
}

export function createSession(db: DatabaseSync, userId: string): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('hex')
  const now = Date.now()
  const expiresAt = now + SESSION_TTL_MS
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now,
    expiresAt,
  )
  return { token, expiresAt }
}

export function destroySession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

/** Returns the session's owning user id if the token is present and unexpired, else undefined — the single place "is this token good, and whose is it" is decided. */
function resolveSession(db: DatabaseSync, token: string): string | undefined {
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token) as unknown as
    | { user_id: string; expires_at: number }
    | undefined
  if (!row) return undefined
  if (row.expires_at < Date.now()) {
    // Opportunistic cleanup — no separate reaper process for a table this small.
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return undefined
  }
  return row.user_id
}

/** No `cookie-parser` dependency for one header — this is the whole parse. */
function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

/**
 * `Secure` is skipped only for plain-HTTP local dev — everywhere this
 * actually runs (behind Traefik, see compose.yml) is HTTPS. Deliberately
 * not `admin-auth@file`/Traefik basic-auth in front instead: a basic-auth
 * 401 breaks the MCP OAuth handshake before it ever reaches this app (the
 * same reason ynab-mcp's compose.yml gives for skipping it).
 */
export function setSessionCookie(res: Response, token: string, expiresAt: number, secure: boolean): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ]
  if (secure) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT']
  if (secure) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

/** Guards every `/api/*` route (mounted before the routers in index.ts). Not the MCP `/mcp` endpoint itself — that's bearer-token auth via requireBearerAuth, see mcp.ts — nor the OAuth consent page, which checks the cookie itself (see consent.ts) since it must redirect to /login rather than 401 on a browser navigation. */
export function requireSession(db: DatabaseSync) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE_NAME)
    const userId = token ? resolveSession(db, token) : undefined
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    req.userId = userId
    next()
  }
}

/** Every route mounted after `requireSession` (see index.ts) is guaranteed to have `req.userId` set — this just gives call sites a non-optional type instead of every route re-checking a condition the middleware already enforced. Throwing (rather than silently proceeding with `undefined`) if that invariant is ever broken by a future reordering is the safer failure mode for a per-user data boundary. */
export function getUserId(req: Request): string {
  if (!req.userId) throw new Error('getUserId called without requireSession in the middleware chain')
  return req.userId
}

export function getSessionToken(req: Request): string | undefined {
  return readCookie(req, SESSION_COOKIE_NAME)
}

/** Used outside the `requireSession` middleware chain (the OAuth consent page) where a 401 JSON response isn't the right failure mode — see consent.ts. */
export function resolveSessionUserId(db: DatabaseSync, req: Request): string | undefined {
  const token = readCookie(req, SESSION_COOKIE_NAME)
  return token ? resolveSession(db, token) : undefined
}

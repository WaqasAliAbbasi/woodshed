import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { Response } from 'express'
import { nullToUndefined, toParam } from '../db.ts'
import { createClientsStore } from './clientsStore.ts'

/** How long an in-flight /authorize round trip (redirect → login → consent) stays valid. Generous on purpose: this is a human clicking through a browser, not a machine-to-machine call. */
const TRANSACTION_TTL_MS = 10 * 60 * 1000
/** RFC-typical short lifetime for the one-time authorization code, between consent and the token exchange. */
const AUTH_CODE_TTL_MS = 10 * 60 * 1000
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 // 1 hour

interface OAuthTransaction {
  txnId: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  scopes: string[]
  state: string | undefined
  resource: string | undefined
}

function issueTokens(
  db: DatabaseSync,
  userId: string,
  clientId: string,
  scopes: string[],
  resource: string | undefined,
): OAuthTokens {
  const accessToken = randomBytes(32).toString('hex')
  const refreshToken = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000
  db.prepare(
    'INSERT INTO oauth_tokens (access_token, refresh_token, user_id, client_id, scopes, resource, expires_at, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
  ).run(accessToken, refreshToken, userId, clientId, JSON.stringify(scopes), toParam(resource), expiresAt)
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: scopes.join(' '),
  }
}

/**
 * Stores a pending /authorize request (see `provider.authorize` below —
 * it's handed only `res`, not `req`, so it can't check the session cookie
 * itself, and so can't know *which* user is authorizing yet either) so the
 * *separately routed* `/oauth/consent` page — which does see the request,
 * cookies included — can pick it back up once someone is logged in and has
 * clicked Allow. See `createConsentRouter` in consent.ts, which is where a
 * user id first enters this flow.
 */
export function beginTransaction(db: DatabaseSync, client: OAuthClientInformationFull, params: AuthorizationParams): string {
  const txnId = randomBytes(16).toString('hex')
  db.prepare(
    'INSERT INTO oauth_transactions (txn_id, client_id, redirect_uri, code_challenge, scopes, state, resource, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    txnId,
    client.client_id,
    params.redirectUri,
    params.codeChallenge,
    JSON.stringify(params.scopes ?? []),
    toParam(params.state),
    toParam(params.resource?.toString()),
    Date.now(),
  )
  return txnId
}

export function getTransaction(db: DatabaseSync, txnId: string): OAuthTransaction | undefined {
  const row = db
    .prepare('SELECT * FROM oauth_transactions WHERE txn_id = ? AND created_at > ?')
    .get(txnId, Date.now() - TRANSACTION_TTL_MS) as unknown as
    | {
        txn_id: string
        client_id: string
        redirect_uri: string
        code_challenge: string
        scopes: string
        state: string | null
        resource: string | null
      }
    | undefined
  if (!row) return undefined
  return {
    txnId: row.txn_id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    codeChallenge: row.code_challenge,
    scopes: JSON.parse(row.scopes) as string[],
    state: nullToUndefined(row.state),
    resource: nullToUndefined(row.resource),
  }
}

export function consumeTransaction(db: DatabaseSync, txnId: string): void {
  db.prepare('DELETE FROM oauth_transactions WHERE txn_id = ?').run(txnId)
}

/** Called from the consent page once a logged-in user clicks Allow — issues the one-time authorization code the client will redeem via `exchangeAuthorizationCode`, bound to *that* user's id so the resulting access token can only ever read their library. */
export function issueAuthorizationCode(db: DatabaseSync, userId: string, txn: OAuthTransaction): string {
  const code = randomBytes(32).toString('hex')
  db.prepare(
    'INSERT INTO oauth_codes (code, user_id, client_id, redirect_uri, code_challenge, scopes, resource, expires_at, consumed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
  ).run(
    code,
    userId,
    txn.clientId,
    txn.redirectUri,
    txn.codeChallenge,
    JSON.stringify(txn.scopes),
    toParam(txn.resource),
    Date.now() + AUTH_CODE_TTL_MS,
  )
  return code
}

/**
 * This app's `OAuthServerProvider` implementation for the MCP endpoint's
 * OAuth 2.1 authorization server (see server/mcp.ts, and the SDK's
 * `mcpAuthRouter`, which drives all of this). Multi-user (see schema.sql):
 * "authorized" here means "logged into this Woodshed instance as some
 * user", checked via the same session cookie the SPA uses (see
 * auth/session.ts) — every code and token this provider issues is bound to
 * that one user's id, so a Claude.ai connection can only ever read the
 * library of whoever clicked Allow, never anyone else's.
 */
export function createOAuthProvider(db: DatabaseSync): OAuthServerProvider {
  return {
    clientsStore: createClientsStore(db),

    async authorize(client, params: AuthorizationParams, res: Response) {
      const txnId = beginTransaction(db, client, params)
      res.redirect(302, `/oauth/consent?txn=${txnId}`)
    },

    async challengeForAuthorizationCode(client, authorizationCode) {
      const row = db.prepare('SELECT client_id, code_challenge, consumed, expires_at FROM oauth_codes WHERE code = ?').get(
        authorizationCode,
      ) as unknown as { client_id: string; code_challenge: string; consumed: number; expires_at: number } | undefined
      if (!row || row.client_id !== client.client_id || row.consumed === 1 || row.expires_at < Date.now()) {
        throw new InvalidGrantError('Invalid or expired authorization code')
      }
      return row.code_challenge
    },

    async exchangeAuthorizationCode(client, authorizationCode) {
      const row = db.prepare('SELECT * FROM oauth_codes WHERE code = ?').get(authorizationCode) as unknown as
        | { client_id: string; user_id: string; scopes: string; resource: string | null; consumed: number; expires_at: number }
        | undefined
      if (!row || row.client_id !== client.client_id || row.consumed === 1 || row.expires_at < Date.now()) {
        throw new InvalidGrantError('Invalid or expired authorization code')
      }
      // Single-use: mark consumed before returning, so a retried/replayed
      // exchange of the same code fails instead of minting a second token pair.
      db.prepare('UPDATE oauth_codes SET consumed = 1 WHERE code = ?').run(authorizationCode)
      return issueTokens(db, row.user_id, client.client_id, JSON.parse(row.scopes) as string[], nullToUndefined(row.resource))
    },

    async exchangeRefreshToken(client, refreshToken, scopes) {
      const row = db.prepare('SELECT * FROM oauth_tokens WHERE refresh_token = ? AND client_id = ? AND revoked = 0').get(
        refreshToken,
        client.client_id,
      ) as unknown as { access_token: string; user_id: string; scopes: string; resource: string | null } | undefined
      if (!row) throw new InvalidGrantError('Invalid or revoked refresh token')
      // Rotate on use: the old pair stops working the moment a new one is
      // issued, so a leaked refresh token has a bounded replay window.
      db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE access_token = ?').run(row.access_token)
      const grantedScopes = scopes && scopes.length > 0 ? scopes : (JSON.parse(row.scopes) as string[])
      return issueTokens(db, row.user_id, client.client_id, grantedScopes, nullToUndefined(row.resource))
    },

    async verifyAccessToken(token) {
      const row = db.prepare('SELECT * FROM oauth_tokens WHERE access_token = ? AND revoked = 0').get(token) as unknown as
        | { client_id: string; user_id: string; scopes: string; resource: string | null; expires_at: number }
        | undefined
      if (!row || row.expires_at < Date.now()) {
        throw new InvalidTokenError('Invalid, expired, or revoked access token')
      }
      return {
        token,
        clientId: row.client_id,
        scopes: JSON.parse(row.scopes) as string[],
        expiresAt: Math.floor(row.expires_at / 1000),
        resource: row.resource ? new URL(row.resource) : undefined,
        // How server/mcp.ts learns which user's data this token may read —
        // see AuthInfo['extra'] and the /mcp route handler.
        extra: { userId: row.user_id },
      }
    },

    async revokeToken(client, request: OAuthTokenRevocationRequest) {
      db.prepare('UPDATE oauth_tokens SET revoked = 1 WHERE client_id = ? AND (access_token = ? OR refresh_token = ?)').run(
        client.client_id,
        request.token,
        request.token,
      )
    },
  }
}

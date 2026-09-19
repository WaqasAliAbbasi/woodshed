/**
 * Reads and validates the process environment once, at boot — imported only
 * by `index.ts`, so nothing else in `server/` triggers this just by being
 * imported, e.g. from a future test file. Every other server module
 * receives what it needs as a plain argument instead of importing this
 * directly.
 *
 * No shared "the" password here — logins are per-user, against the `users`
 * table (see auth/session.ts and scripts/createUser.ts), not a single env
 * var. There's nothing this module strictly requires to exist yet, but it
 * stays as the one place env parsing happens, so a future required setting
 * has an obvious home.
 */
export interface Env {
  port: number
  isProduction: boolean
  dbPath: string
  /** The canonical public origin — used as the MCP OAuth issuer/resource URL (RFC 8707) and to decide whether cookies get the `Secure` flag. Must be the real HTTPS origin in production; the SDK's OAuth router rejects a non-HTTPS, non-localhost issuer outright. */
  publicUrl: string
}

export function loadEnv(): Env {
  const port = Number(process.env.PORT ?? 3000)
  return {
    port,
    isProduction: process.env.NODE_ENV === 'production',
    dbPath: process.env.DB_PATH ?? './data/woodshed.db',
    publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,
  }
}

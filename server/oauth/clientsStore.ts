import type { DatabaseSync } from 'node:sqlite'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'

/**
 * SQLite-backed registered-clients store for the MCP OAuth 2.1 authorization
 * server (see provider.ts). This app *is* the AS — Claude.ai registers
 * itself via Dynamic Client Registration the first time someone adds it as
 * a custom connector, so there's no fixed client list to seed by hand.
 */
export function createClientsStore(db: DatabaseSync): OAuthRegisteredClientsStore {
  return {
    getClient(clientId: string): OAuthClientInformationFull | undefined {
      const row = db.prepare('SELECT info FROM oauth_clients WHERE client_id = ?').get(clientId) as unknown as
        | { info: string }
        | undefined
      if (!row) return undefined
      return JSON.parse(row.info) as OAuthClientInformationFull
    },

    registerClient(client) {
      // The router's registration handler generates client_id (and, unless
      // this is a public client, client_secret) *before* calling this — the
      // interface's `Omit<..., 'client_id' | ...>` param type only accounts
      // for the case where the store itself would assign the id, which this
      // one doesn't (clientIdGeneration stays at its default of true in
      // router.ts). The id is always present on the object at runtime here.
      const full = client as OAuthClientInformationFull
      db.prepare('INSERT INTO oauth_clients (client_id, info, created_at) VALUES (?, ?, ?)').run(
        full.client_id,
        JSON.stringify(full),
        Date.now(),
      )
      return full
    },
  }
}

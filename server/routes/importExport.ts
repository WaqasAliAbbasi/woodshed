import type { DatabaseSync } from 'node:sqlite'
import express, { type Router } from 'express'
import { getUserId } from '../auth/session.ts'
import * as queries from '../queries.ts'

/**
 * Same document shape as `src/lib/db/export.ts` (`WoodshedExport`) — kept as
 * a plain structural check here rather than importing that module directly,
 * since it in turn imports browser-only code (`../api/client`'s `fetch`
 * wrapper) that has no business resolving on the server.
 */
function isImportDocument(value: unknown): value is { pieces: unknown[]; sections: unknown[]; attempts: unknown[] } {
  if (!value || typeof value !== 'object') return false
  const doc = value as Record<string, unknown>
  return Array.isArray(doc.pieces) && Array.isArray(doc.sections) && Array.isArray(doc.attempts)
}

export function createImportExportRouter(db: DatabaseSync): Router {
  const router = express.Router()

  // The server-side half of the standing backup story, and a manual
  // restore path — same shape `buildExport()` produces client-side. Scoped
  // to the logged-in user only — there's no "export everyone" endpoint.
  router.get('/api/export', (req, res) => {
    const doc = queries.exportAll(db, getUserId(req))
    res.json({ version: 1, exportedAt: Date.now(), ...doc })
  })

  // The one-time "upload my local history" migration target — see
  // `uploadLocalHistoryToServer` in `src/lib/db/import.ts`. Upserts
  // everything by id (queries.importAll), so re-running it (a retry after
  // a network error, or a second device with the same export) is harmless.
  // Everything in the document is attributed to the logged-in user, not
  // whatever it looked like locally (IndexedDB has no user concept).
  router.post('/api/import', (req, res) => {
    const body = req.body as unknown
    if (!isImportDocument(body)) {
      res.status(400).json({ error: 'Not a Woodshed export document' })
      return
    }
    queries.importAll(db, getUserId(req), body as Parameters<typeof queries.importAll>[2])
    res.json({ pieces: body.pieces.length, sections: body.sections.length, attempts: body.attempts.length })
  })

  return router
}

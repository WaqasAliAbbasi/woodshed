import { getDb, type Attempt, type Piece, type Section } from './db'

/**
 * Bumped only if the shape of this document changes in a way `import.ts`
 * can't read — e.g. a renamed/removed field. Adding an optional field
 * doesn't need a bump.
 */
export const EXPORT_VERSION = 1

export interface WoodshedExport {
  version: typeof EXPORT_VERSION
  exportedAt: number
  pieces: Piece[]
  sections: Section[]
  attempts: Attempt[]
}

/**
 * Reads the three IndexedDB stores directly — deliberately **not** through
 * `piecesRepo`/`sectionsRepo`/`attemptsRepo`, which (post-cutover) proxy to
 * the server. This is the one place in the app that still talks to
 * IndexedDB as the source of truth, because its whole purpose is capturing
 * whatever a browser already has stored *before* that data ever reaches the
 * server — the one-time migration path, and a standing local backup.
 *
 * Every piece's `musicXml` and every attempt's `noteResults` are included in
 * full, deliberately unlike the server's list endpoints (see
 * `server/routes/`), which trim those for payload size — this is a backup
 * artifact, not something fetched on every page load.
 */
export async function buildExport(): Promise<WoodshedExport> {
  const db = await getDb()
  const [pieces, sections, attempts] = await Promise.all([
    db.getAll('pieces'),
    db.getAll('sections'),
    db.getAll('attempts'),
  ])
  return { version: EXPORT_VERSION, exportedAt: Date.now(), pieces, sections, attempts }
}

/** Triggers a browser download of `buildExport()`'s output — no server round-trip, so this works even if the backend is unreachable. */
export async function downloadExport(): Promise<void> {
  const doc = await buildExport()
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = new Date(doc.exportedAt).toISOString().slice(0, 10)
  a.href = url
  a.download = `woodshed-export-${date}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

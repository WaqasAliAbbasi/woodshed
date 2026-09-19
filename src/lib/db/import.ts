import { apiPost } from '../api/client'
import { getDb } from './db'
import { buildExport, EXPORT_VERSION, type WoodshedExport } from './export'

/** Loose shape check on a user-picked file before touching IndexedDB or the network with it — not full schema validation, just enough to fail loudly on the wrong file instead of silently storing garbage. */
export function isWoodshedExport(value: unknown): value is WoodshedExport {
  if (!value || typeof value !== 'object') return false
  const doc = value as Record<string, unknown>
  return (
    doc.version === EXPORT_VERSION &&
    typeof doc.exportedAt === 'number' &&
    Array.isArray(doc.pieces) &&
    Array.isArray(doc.sections) &&
    Array.isArray(doc.attempts)
  )
}

export async function readExportFile(file: File): Promise<WoodshedExport> {
  const text = await file.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file isn’t valid JSON.')
  }
  if (!isWoodshedExport(parsed)) {
    throw new Error('That doesn’t look like a Woodshed export file.')
  }
  return parsed
}

/**
 * Writes an export document directly into this browser's IndexedDB stores —
 * bypassing the repo layer for the same reason `export.ts` does (see its
 * doc comment). Upserts by id (`put`, not `add`), so importing the same file
 * twice is harmless. Used for local restore and for the export↔import
 * round-trip check called for in the migration plan, not for the server
 * migration itself — see `uploadLocalHistoryToServer` for that.
 */
export async function importIntoLocalDb(doc: WoodshedExport): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['pieces', 'sections', 'attempts'], 'readwrite')
  await Promise.all([
    ...doc.pieces.map((p) => tx.objectStore('pieces').put(p)),
    ...doc.sections.map((s) => tx.objectStore('sections').put(s)),
    ...doc.attempts.map((a) => tx.objectStore('attempts').put(a)),
  ])
  await tx.done
}

/**
 * The actual one-time migration path: reads this browser's IndexedDB
 * (whatever was stored before the server existed) and upserts it into the
 * server's database. Idempotent — every record is upserted by its existing
 * id, so running it more than once (e.g. a retry after a network error)
 * never duplicates anything.
 */
export async function uploadLocalHistoryToServer(): Promise<{ pieces: number; sections: number; attempts: number }> {
  const doc = await buildExport()
  return apiPost('/api/import', doc)
}

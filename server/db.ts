import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Node's built-in `node:sqlite` (stable enough for this app's single-writer,
 * single-box use — see the ExperimentalWarning it logs at boot, which is
 * about the API surface, not data safety) rather than `better-sqlite3`.
 * Deliberate: the client Dockerfile runs `npm ci --ignore-scripts` (to skip
 * `canvas`'s prebuild step, see its own comment there), which would silently
 * skip `better-sqlite3`'s native compile too — no native module, no
 * toolchain to install in the alpine build stage for it, no compiled
 * binary to go stale across Node versions.
 */
export function openDb(dbPath: string): DatabaseSync {
  // SQLite won't create a missing parent directory itself — matters for
  // the default `./data/woodshed.db` on a fresh checkout (no `data/` in
  // git) as much as for a custom DB_PATH someone points somewhere new.
  // `:memory:` (a real SQLite special path, unused by this app today but
  // not worth breaking) has no meaningful parent, so skip it.
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  // WAL: readers (e.g. an MCP tool call) don't block the practice-session
  // writer, and vice versa. journal_mode is a per-database-file setting
  // that persists after being set once, but setting it every boot is free
  // and self-documenting.
  db.exec('PRAGMA journal_mode = WAL')
  // Off by default in SQLite for backwards compatibility, not because it's
  // usually what you want — this schema relies on ON DELETE CASCADE
  // (pieces -> sections -> attempts) to replace the client's old hand-rolled
  // multi-store delete transaction (see the previous piecesRepo.deletePiece).
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))
  addMissingColumns(db)
  return db
}

/**
 * The expand half of every column added to a table that already existed on
 * a live database. schema.sql is `CREATE TABLE IF NOT EXISTS` throughout,
 * so a column added to one of those statements reaches a *fresh* database
 * only — an existing table keeps the shape it was created with and the new
 * column silently never appears. Adding it here is what actually migrates
 * a real instance.
 *
 * Entries must be additive and nullable, never a rename, a drop, or a NOT
 * NULL without a default: a running instance keeps serving the previous
 * version's code until it restarts, so anything here has to be invisible to
 * that code. A change that can't be expressed this way needs a genuine
 * expand/contract pass (add new column, backfill, switch reads, drop old)
 * across more than one deploy — not an entry in this list.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: 'pieces', column: 'target_tempo_bpm', definition: 'INTEGER' },
  // Which practice_sessions row this attempt was clustered into — see
  // schema.sql's doc comment on that table and queries.ts's
  // assignAttemptToSession. Nullable, and stays that way transiently even
  // on a fresh insert: recordAttempt's own transaction is what sets it,
  // not a DEFAULT here. ON DELETE SET NULL (not CASCADE, and not
  // expressible via ALTER TABLE ADD COLUMN on SQLite anyway) is enforced
  // in application code instead — see deleteSession, which only ever
  // allows deleting a manual session, and getSession's practice_sessions
  // rows are never the target of a piece cascade.
  { table: 'attempts', column: 'session_id', definition: 'TEXT REFERENCES practice_sessions(id)' },
]

function addMissingColumns(db: DatabaseSync): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    // SQLite has no ADD COLUMN IF NOT EXISTS, and re-running a plain ALTER
    // throws — so the PRAGMA check is what makes boot idempotent.
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (columns.some((c) => c.name === column)) continue
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

/** node:sqlite's bind params reject `undefined` and JS booleans outright (see its own TypeError) — every optional/boolean column goes through this before binding. */
export function toParam(value: unknown): string | number | bigint | Uint8Array | null {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value as string | number | bigint | Uint8Array | null
}

/** The inverse for a column written via `toParam(someBoolean)` — SQLite has no boolean type, so these round-trip as 0/1. */
export function fromIntBoolean(value: unknown): boolean {
  return value === 1 || value === 1n
}

/** `null` read back from an optional column maps to `undefined`, matching this app's `field?: T` convention (see `src/lib/db/db.ts`) rather than SQL's `null`. */
export function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value
}

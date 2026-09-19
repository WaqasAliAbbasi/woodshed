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
  return db
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

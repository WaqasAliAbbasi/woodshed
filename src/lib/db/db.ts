import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
// Explicit .ts extensions on these two (unlike most imports in this
// codebase) so this file also resolves under Node's native ESM loader, not
// just Vite's bundler resolution — server/queries.ts imports it directly,
// unbundled, reusing these types for the SQL row mapping instead of a
// parallel set of DTOs.
import type { HandFilter } from '../musicxml/buildExpectedTimeline.ts'
import type { AttemptAggregate, PracticeMode, StoredNoteResult } from '../scoring/types.ts'

export interface Piece {
  id: string
  title: string
  composer?: string
  filename: string
  musicXml: string
  createdAt: number
  updatedAt: number
  measureCount: number
}

export interface Section {
  id: string
  pieceId: string
  label: string
  startMeasure: number
  endMeasure: number
  defaultTempoBpm: number
  createdAt: number
  /** Absent on sections created before hands-separate practice existed — treat as 'both'. */
  handFilter?: HandFilter
  /** Absent on sections created before Notes mode existed — treat as 'metronome'. */
  mode?: PracticeMode
}

export interface Attempt {
  id: string
  sectionId: string
  pieceId: string
  tempoBpm: number
  timestamp: number
  aborted: boolean
  aggregate: AttemptAggregate
  /** Wall-clock length of the attempt (count-in through finalize), in ms. Absent on attempts recorded before this was tracked. */
  durationMs?: number
  /** GraphicalNote references are stripped before storage — see StoredNoteResult. */
  noteResults: StoredNoteResult[]
}

interface WoodshedDbSchema extends DBSchema {
  pieces: { key: string; value: Piece; indexes: { createdAt: number } }
  sections: { key: string; value: Section; indexes: { pieceId: string } }
  attempts: { key: string; value: Attempt; indexes: { sectionId: string; pieceId: string; timestamp: number } }
  /**
   * A write-behind outbox, not the app's source of truth anymore — the
   * server is (see `server/`). `recordAttempt` (attemptsRepo.ts) writes a
   * finished attempt here first and resolves immediately, so a slow or
   * dropped connection right after a practice session never strands the
   * UI; it's pushed to `/api/attempts` in the background and removed once
   * acknowledged. `pieces`/`sections`/`attempts` above are no longer
   * written to during normal use — they exist only so `export.ts` can still
   * read whatever a browser stored before this server existed.
   */
  outbox: { key: string; value: Attempt }
}

const DB_NAME = 'woodshed-v2'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<WoodshedDbSchema>> | undefined

export function getDb(): Promise<IDBPDatabase<WoodshedDbSchema>> {
  dbPromise ??= openDB<WoodshedDbSchema>(DB_NAME, DB_VERSION, {
    // `oldVersion`-gated so a browser upgrading from v1 doesn't try to
    // recreate stores it already has (createObjectStore throws on a
    // name that already exists) — only the new `outbox` store is added
    // for those; a fresh browser gets both steps in one pass.
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const pieces = db.createObjectStore('pieces', { keyPath: 'id' })
        pieces.createIndex('createdAt', 'createdAt')

        const sections = db.createObjectStore('sections', { keyPath: 'id' })
        sections.createIndex('pieceId', 'pieceId')

        const attempts = db.createObjectStore('attempts', { keyPath: 'id' })
        attempts.createIndex('sectionId', 'sectionId')
        attempts.createIndex('pieceId', 'pieceId')
        attempts.createIndex('timestamp', 'timestamp')
      }
      if (oldVersion < 2) {
        db.createObjectStore('outbox', { keyPath: 'id' })
      }
    },
  })
  return dbPromise
}

/**
 * Test-only: closes the current connection (IndexedDB's deleteDatabase()
 * blocks until every open connection to it is closed, so tests that delete
 * the database between cases must close the previous one first) and forces
 * a fresh connection on the next getDb() call.
 */
export async function resetDbConnectionForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
  }
  dbPromise = undefined
}

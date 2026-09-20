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
  /**
   * The tempo this piece is currently being worked up to — the bar a
   * section has to be played clean at to count as ready. Absent until the
   * student sets one (and on every piece that predates the setting), in
   * which case the score's own marked tempo stands in; only the client can
   * read that out of the MusicXML, so it is resolved there rather than
   * stored as a default here.
   */
  targetTempoBpm?: number
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
  /**
   * A write-behind outbox, not the app's source of truth anymore — the
   * server is (see `server/`). `recordAttempt` (attemptsRepo.ts) writes a
   * finished attempt here first and resolves immediately, so a slow or
   * dropped connection right after a practice session never strands the
   * UI; it's pushed to `/api/attempts` in the background and removed once
   * acknowledged.
   */
  outbox: { key: string; value: Attempt }
}

const DB_NAME = 'woodshed-v2'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<WoodshedDbSchema>> | undefined

export function getDb(): Promise<IDBPDatabase<WoodshedDbSchema>> {
  dbPromise ??= openDB<WoodshedDbSchema>(DB_NAME, DB_VERSION, {
    // A browser already past v1 has `pieces`/`sections`/`attempts` stores
    // left over from before the server existed — createObjectStore isn't
    // called for them here anymore since nothing writes or reads them, but
    // they're harmless leftovers in those browsers' IndexedDB and not worth
    // a migration step to delete.
    upgrade(db, oldVersion) {
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

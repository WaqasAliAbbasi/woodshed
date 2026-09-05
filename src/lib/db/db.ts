import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AttemptAggregate, StoredNoteResult } from '../scoring/types'

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
}

export interface Attempt {
  id: string
  sectionId: string
  pieceId: string
  tempoBpm: number
  timestamp: number
  aborted: boolean
  aggregate: AttemptAggregate
  /** GraphicalNote references are stripped before storage — see StoredNoteResult. */
  noteResults: StoredNoteResult[]
}

interface WoodshedDbSchema extends DBSchema {
  pieces: { key: string; value: Piece; indexes: { createdAt: number } }
  sections: { key: string; value: Section; indexes: { pieceId: string } }
  attempts: { key: string; value: Attempt; indexes: { sectionId: string; pieceId: string; timestamp: number } }
}

const DB_NAME = 'woodshed-v2'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<WoodshedDbSchema>> | undefined

export function getDb(): Promise<IDBPDatabase<WoodshedDbSchema>> {
  dbPromise ??= openDB<WoodshedDbSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const pieces = db.createObjectStore('pieces', { keyPath: 'id' })
      pieces.createIndex('createdAt', 'createdAt')

      const sections = db.createObjectStore('sections', { keyPath: 'id' })
      sections.createIndex('pieceId', 'pieceId')

      const attempts = db.createObjectStore('attempts', { keyPath: 'id' })
      attempts.createIndex('sectionId', 'sectionId')
      attempts.createIndex('pieceId', 'pieceId')
      attempts.createIndex('timestamp', 'timestamp')
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

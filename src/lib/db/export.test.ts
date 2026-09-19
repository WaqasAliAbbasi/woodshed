import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb, resetDbConnectionForTests, type Attempt, type Piece, type Section } from './db'
import { buildExport } from './export'
import { importIntoLocalDb, isWoodshedExport } from './import'

const samplePiece: Piece = {
  id: 'piece-1',
  title: 'Sonatina',
  filename: 'sonatina.musicxml',
  musicXml: '<score-partwise/>',
  createdAt: 1000,
  updatedAt: 1000,
  measureCount: 38,
}

const sampleSection: Section = {
  id: 'section-1',
  pieceId: 'piece-1',
  label: 'Measures 1-4',
  startMeasure: 1,
  endMeasure: 4,
  defaultTempoBpm: 80,
  createdAt: 1000,
}

const sampleAttempt: Attempt = {
  id: 'attempt-1',
  sectionId: 'section-1',
  pieceId: 'piece-1',
  tempoBpm: 80,
  timestamp: 2000,
  aborted: false,
  aggregate: {
    expected: 4,
    correct: 4,
    missed: 0,
    extra: 0,
    onTime: 4,
    early: 0,
    late: 0,
    pitchAccuracy: 1,
    timingAccuracy: 1,
  },
  noteResults: [],
}

beforeEach(async () => {
  await resetDbConnectionForTests()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('woodshed-v2')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

/** Writes straight into IndexedDB's `pieces`/`sections`/`attempts` stores — the same way `export.ts` itself reads, and deliberately not through `piecesRepo`/`sectionsRepo`/`attemptsRepo`, which (post-cutover) talk to the server instead. See export.ts's own doc comment. */
async function seedLibrary() {
  const db = await getDb()
  await db.put('pieces', samplePiece)
  await db.put('sections', sampleSection)
  await db.put('attempts', sampleAttempt)
}

describe('buildExport', () => {
  it('captures every piece, section, and attempt currently in IndexedDB', async () => {
    await seedLibrary()
    const doc = await buildExport()

    expect(doc.pieces).toEqual([samplePiece])
    expect(doc.sections).toEqual([sampleSection])
    expect(doc.attempts).toEqual([sampleAttempt])
  })

  it('produces a document isWoodshedExport recognizes, and an empty one for an empty library', async () => {
    const doc = await buildExport()
    expect(isWoodshedExport(doc)).toBe(true)
    expect(doc.pieces).toEqual([])
  })
})

describe('isWoodshedExport', () => {
  it('rejects unrelated JSON', () => {
    expect(isWoodshedExport({ hello: 'world' })).toBe(false)
    expect(isWoodshedExport(null)).toBe(false)
    expect(isWoodshedExport('not an object')).toBe(false)
  })

  it('rejects a document with the wrong version', () => {
    expect(isWoodshedExport({ version: 999, exportedAt: 1, pieces: [], sections: [], attempts: [] })).toBe(false)
  })
})

describe('export -> import round trip', () => {
  it('reproduces an identical export after importing into a fresh database', async () => {
    await seedLibrary()
    const original = await buildExport()

    await resetDbConnectionForTests()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('woodshed-v2')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })

    await importIntoLocalDb(original)
    const reimported = await buildExport()

    expect(reimported.pieces).toEqual(original.pieces)
    expect(reimported.sections).toEqual(original.sections)
    expect(reimported.attempts).toEqual(original.attempts)
  })

  it('upserts idempotently — importing the same document twice does not duplicate records', async () => {
    await seedLibrary()
    const doc = await buildExport()

    await importIntoLocalDb(doc)
    await importIntoLocalDb(doc)

    const db = await getDb()
    expect(await db.count('pieces')).toBe(1)
    expect(await db.count('sections')).toBe(1)
    expect(await db.count('attempts')).toBe(1)
  })
})

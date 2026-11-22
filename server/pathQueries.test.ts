import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { Piece } from '../src/lib/db/db.ts'
import { createUser } from './auth/session.ts'
import { openDb } from './db.ts'
import * as queries from './queries.ts'

function setup() {
  const db = openDb(':memory:')
  const alice = createUser(db, 'alice', 'a-good-password')!.id
  const bob = createUser(db, 'bob', 'a-good-password')!.id
  const piece = (userId: string, id: string): Piece => {
    const p: Piece = { id, title: id, filename: `${id}.musicxml`, musicXml: '<x/>', createdAt: 1, updatedAt: 1, measureCount: 0 }
    queries.createPiece(db, userId, p)
    return p
  }
  return { db, alice, bob, piece }
}

const plan = [
  { idx: 0, startMeasure: 1, endMeasure: 4 },
  { idx: 1, startMeasure: 5, endMeasure: 8 },
  { idx: 2, startMeasure: 9, endMeasure: 12, repeatOfIdx: 0 },
]

describe('chunks', () => {
  it('stores chunks once, links repeats by id, and records the measure counts', () => {
    const { db, alice, piece } = setup()
    piece(alice, 'p1')
    const chunks = queries.createChunks(db, alice, 'p1', { chunks: plan, measureCount: 12, newMeasureCount: 8 })
    expect(chunks.map((c) => [c.idx, c.startMeasure, c.endMeasure])).toEqual([
      [0, 1, 4],
      [1, 5, 8],
      [2, 9, 12],
    ])
    expect(chunks[2].repeatOfChunkId).toBe(chunks[0].id)
    expect(queries.getPieceSummary(db, alice, 'p1')).toMatchObject({ measureCount: 12, newMeasureCount: 8 })

    const again = queries.createChunks(db, alice, 'p1', { chunks: plan.slice(0, 1), measureCount: 4, newMeasureCount: 4 })
    expect(again.map((c) => c.id)).toEqual(chunks.map((c) => c.id))
  })

  it("never shows one user another's chunks or path sections", () => {
    const { db, alice, bob, piece } = setup()
    piece(alice, 'p1')
    const [c0] = queries.createChunks(db, alice, 'p1', { chunks: plan, measureCount: 12, newMeasureCount: 8 })
    queries.createSection(db, alice, {
      id: 's1',
      pieceId: 'p1',
      label: 'Chunk 1 · Notes',
      startMeasure: 1,
      endMeasure: 4,
      defaultTempoBpm: 80,
      createdAt: 1,
      chunkId: c0.id,
      rung: 'notes',
      mode: 'notes',
    })
    expect(queries.listChunks(db, bob)).toEqual([])
    expect(queries.listChunksForPiece(db, bob, 'p1')).toEqual([])
    expect(queries.listPathSections(db, bob)).toEqual([])
    expect(queries.chunkBelongsToPiece(db, bob, c0.id, 'p1')).toBe(false)
    expect(queries.listPathSections(db, alice)).toMatchObject([{ id: 's1', chunkId: c0.id, rung: 'notes' }])
  })

  it('lists path attempts without note results, and leaves Free practice out', () => {
    const { db, alice, piece } = setup()
    piece(alice, 'p1')
    const [c0] = queries.createChunks(db, alice, 'p1', { chunks: plan, measureCount: 12, newMeasureCount: 8 })
    const base = { pieceId: 'p1', label: 'x', startMeasure: 1, endMeasure: 4, defaultTempoBpm: 80, createdAt: 1 }
    queries.createSection(db, alice, { ...base, id: 'path', chunkId: c0.id, rung: 'notes' })
    queries.createSection(db, alice, { ...base, id: 'free' })
    const agg = { expected: 1, correct: 1, missed: 0, extra: 0, onTime: 1, early: 0, late: 0, pitchAccuracy: 1, timingAccuracy: 1 }
    for (const sectionId of ['path', 'free']) {
      queries.recordAttempt(db, alice, {
        id: `a-${sectionId}`,
        sectionId,
        pieceId: 'p1',
        tempoBpm: 80,
        timestamp: 1000,
        aborted: false,
        aggregate: agg,
        noteResults: [{ classification: 'onTime' }],
      })
    }
    const attempts = queries.listPathAttempts(db, alice)
    expect(attempts.map((a) => a.id)).toEqual(['a-path'])
    expect(attempts[0]).not.toHaveProperty('noteResults')
  })
})

describe('lessons', () => {
  it('logs a lesson as a manual "Lesson" session with outcomes, and marks Finished pieces done', () => {
    const { db, alice, piece } = setup()
    for (const id of ['berry', 'divert', 'lullaby']) piece(alice, id)
    const lesson = queries.createLesson(db, alice, {
      startedAt: 5000,
      endedAt: 5000 + 45 * 60_000,
      note: 'Use weight, not speed.',
      pieces: [
        { pieceId: 'berry', outcome: 'finished' },
        { pieceId: 'divert', outcome: 'continue', focus: 'Chunk 3 up to 69' },
        { pieceId: 'lullaby', outcome: 'new' },
      ],
    })
    expect(lesson.pieces.map((p) => p.outcome)).toEqual(['finished', 'continue', 'new'])
    expect(queries.getSession(db, alice, lesson.sessionId)).toMatchObject({ source: 'manual', label: 'Lesson', note: 'Use weight, not speed.' })
    expect(queries.getPieceSummary(db, alice, 'berry')?.finishedAt).toBe(5000)
    expect(queries.getPieceSummary(db, alice, 'divert')?.finishedAt).toBeUndefined()

    // A later lesson putting it back to Keep going un-finishes it.
    queries.createLesson(db, alice, { startedAt: 9000, endedAt: 9000, pieces: [{ pieceId: 'berry', outcome: 'continue' }] })
    expect(queries.getPieceSummary(db, alice, 'berry')?.finishedAt).toBeUndefined()
    expect(queries.listLessons(db, alice).map((l) => l.startedAt)).toEqual([9000, 5000])
  })

  it('deletes its outcomes with the session', () => {
    const { db, alice, bob, piece } = setup()
    piece(alice, 'p1')
    const lesson = queries.createLesson(db, alice, { startedAt: 1, endedAt: 2, pieces: [{ pieceId: 'p1', outcome: 'new' }] })
    expect(queries.listLessons(db, bob)).toEqual([])
    queries.deleteSession(db, alice, lesson.sessionId)
    expect(queries.listLessons(db, alice)).toEqual([])
  })
})

describe('collections', () => {
  it('keeps a book in page order and scopes it to its owner', () => {
    const { db, alice, bob, piece } = setup()
    for (const id of ['a', 'b', 'c']) piece(alice, id)
    const book = queries.createCollection(db, alice, { name: 'Book 2', kind: 'book' })
    queries.addPieceToCollection(db, alice, book.id, 'b', { page: 57 })
    queries.addPieceToCollection(db, alice, book.id, 'a', { page: 4 })
    queries.addPieceToCollection(db, alice, book.id, 'c', { page: 130 })
    expect(queries.getCollection(db, alice, book.id)?.pieces.map((p) => p.pieceId)).toEqual(['a', 'b', 'c'])
    expect(queries.listCollections(db, bob)).toEqual([])
    expect(queries.ownsCollection(db, bob, book.id)).toBe(false)
    expect(queries.deleteCollection(db, bob, book.id)).toBe(false)
  })

  it('stores an exam date and clears it', () => {
    const { db, alice } = setup()
    const exam = queries.createCollection(db, alice, { name: 'ABRSM Grade 1', kind: 'exam', examDate: 123 })
    expect(exam.examDate).toBe(123)
    expect(queries.updateCollection(db, alice, exam.id, { examDate: null })?.examDate).toBeUndefined()
  })
})

describe('settings', () => {
  it('stores the lesson weekday per user', () => {
    const { db, alice, bob } = setup()
    expect(queries.updateSettings(db, alice, { lessonWeekday: 6 })).toEqual({ lessonWeekday: 6 })
    expect(queries.getSettings(db, bob)).toEqual({ lessonWeekday: undefined })
  })
})

describe('migrating a live database', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('adds the path columns to tables created before them, keeping existing rows', () => {
    dir = mkdtempSync(join(tmpdir(), 'woodshed-'))
    const path = join(dir, 'old.db')
    const old = new DatabaseSync(path)
    // The shapes these tables had before the learning path.
    old.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE pieces (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, composer TEXT, filename TEXT NOT NULL,
        music_xml TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, measure_count INTEGER NOT NULL, target_tempo_bpm INTEGER);
      CREATE TABLE sections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, piece_id TEXT NOT NULL, label TEXT NOT NULL, start_measure INTEGER NOT NULL,
        end_measure INTEGER NOT NULL, default_tempo_bpm INTEGER NOT NULL, created_at INTEGER NOT NULL, hand_filter TEXT, mode TEXT);
      INSERT INTO users VALUES ('u1', 'alice', 'x', 1);
      INSERT INTO pieces VALUES ('p1', 'u1', 'Old piece', NULL, 'old.xml', '<x/>', 1, 1, 8, NULL);
      INSERT INTO sections VALUES ('s1', 'u1', 'p1', 'Measures 1-4', 1, 4, 80, 1, NULL, NULL);
    `)
    old.close()

    const db = openDb(path)
    const columns = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    expect(columns('sections')).toEqual(expect.arrayContaining(['chunk_id', 'rung']))
    expect(columns('pieces')).toEqual(expect.arrayContaining(['finished_at', 'new_measure_count']))
    expect(columns('users')).toContain('lesson_weekday')
    expect(queries.listSectionsForPiece(db, 'u1', 'p1')).toMatchObject([{ id: 's1', label: 'Measures 1-4', chunkId: undefined, rung: undefined }])
    expect(queries.getPiece(db, 'u1', 'p1')?.title).toBe('Old piece')
    db.close()
  })
})

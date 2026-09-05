import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { recordAttempt, listAttemptsForPiece, listAttemptsForSection } from './attemptsRepo'
import { getDb, resetDbConnectionForTests } from './db'
import { createPiece, deletePiece, getPiece, listPieces } from './piecesRepo'
import { createSection, listSectionsForPiece } from './sectionsRepo'

const sampleAggregate = {
  expected: 4,
  correct: 4,
  missed: 0,
  extra: 0,
  onTime: 4,
  early: 0,
  late: 0,
  pitchAccuracy: 1,
  timingAccuracy: 1,
}

beforeEach(async () => {
  await resetDbConnectionForTests()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('woodshed-v2')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe('piecesRepo', () => {
  it('creates and retrieves a piece', async () => {
    const piece = await createPiece({
      title: 'Sonatina',
      filename: 'sonatina.musicxml',
      musicXml: '<score-partwise/>',
      measureCount: 38,
    })
    expect(piece.id).toBeTruthy()
    const fetched = await getPiece(piece.id)
    expect(fetched?.title).toBe('Sonatina')
  })

  it('lists pieces ordered by createdAt', async () => {
    // IndexedDB breaks ties on equal index values by primary key, not
    // insertion order — since ids are random UUIDs, two pieces created
    // within the same millisecond (as happens back-to-back in a fast test)
    // would sort unpredictably unless createdAt actually differs.
    // Warm up the connection first so its own internal Date.now() use (during
    // the one-time open/upgrade transaction) doesn't consume a mocked value.
    await getDb()
    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValueOnce(1000)
    const first = await createPiece({ title: 'First', filename: 'a.musicxml', musicXml: '', measureCount: 1 })
    nowSpy.mockReturnValueOnce(2000)
    const second = await createPiece({ title: 'Second', filename: 'b.musicxml', musicXml: '', measureCount: 1 })
    nowSpy.mockRestore()

    const pieces = await listPieces()
    expect(pieces.map((p) => p.id)).toEqual([first.id, second.id])
  })

  it('deletes a piece', async () => {
    const piece = await createPiece({ title: 'Temp', filename: 't.musicxml', musicXml: '', measureCount: 1 })
    await deletePiece(piece.id)
    expect(await getPiece(piece.id)).toBeUndefined()
  })
})

describe('sectionsRepo', () => {
  it('creates a section and lists sections scoped to its piece', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const otherPiece = await createPiece({ title: 'Other', filename: 'o.musicxml', musicXml: '', measureCount: 10 })
    await createSection({ pieceId: piece.id, label: 'Opening', startMeasure: 1, endMeasure: 4, defaultTempoBpm: 80 })
    await createSection({ pieceId: otherPiece.id, label: 'Elsewhere', startMeasure: 1, endMeasure: 2, defaultTempoBpm: 60 })

    const sections = await listSectionsForPiece(piece.id)
    expect(sections).toHaveLength(1)
    expect(sections[0].label).toBe('Opening')
  })
})

describe('attemptsRepo', () => {
  it('records an attempt and lists it by section and by piece', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const section = await createSection({
      pieceId: piece.id,
      label: 'Opening',
      startMeasure: 1,
      endMeasure: 4,
      defaultTempoBpm: 80,
    })

    await recordAttempt({
      sectionId: section.id,
      pieceId: piece.id,
      tempoBpm: 80,
      aborted: false,
      aggregate: sampleAggregate,
      noteResults: [],
    })

    const bySection = await listAttemptsForSection(section.id)
    const byPiece = await listAttemptsForPiece(piece.id)
    expect(bySection).toHaveLength(1)
    expect(byPiece).toHaveLength(1)
    expect(bySection[0].aggregate.pitchAccuracy).toBe(1)
  })
})

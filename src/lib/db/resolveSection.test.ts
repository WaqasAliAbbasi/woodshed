import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDbConnectionForTests } from './db'
import { createPiece } from './piecesRepo'
import { resolveSection } from './resolveSection'
import { createSection, listSectionsForPiece } from './sectionsRepo'

beforeEach(async () => {
  await resetDbConnectionForTests()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('woodshed-v2')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

const range = { startMeasure: 1, endMeasure: 4 }

describe('resolveSection', () => {
  it('creates a new section labeled with the range when none exists', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const section = await resolveSection(piece.id, range, 80, 'both')
    expect(section.label).toBe('Measures 1-4')
    expect(section.handFilter).toBe('both')
  })

  it('labels a hand-isolated section distinctly', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const right = await resolveSection(piece.id, range, 80, 'right')
    const left = await resolveSection(piece.id, range, 80, 'left')
    expect(right.label).toBe('Measures 1-4 (Right hand)')
    expect(left.label).toBe('Measures 1-4 (Left hand)')
  })

  it('reuses an existing section for the same range and hand filter instead of creating a duplicate', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const first = await resolveSection(piece.id, range, 80, 'both')
    const second = await resolveSection(piece.id, range, 100, 'both')
    expect(second.id).toBe(first.id)
    expect((await listSectionsForPiece(piece.id))).toHaveLength(1)
  })

  it('treats the same range with a different hand filter as a distinct section', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const both = await resolveSection(piece.id, range, 80, 'both')
    const right = await resolveSection(piece.id, range, 80, 'right')
    expect(right.id).not.toBe(both.id)
    expect((await listSectionsForPiece(piece.id))).toHaveLength(2)
  })

  it('treats a legacy section with no stored handFilter as "both", matching a fresh both-hands attempt', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const legacy = await createSection({
      pieceId: piece.id,
      label: 'Measures 1-4',
      startMeasure: 1,
      endMeasure: 4,
      defaultTempoBpm: 80,
    })
    const resolved = await resolveSection(piece.id, range, 80, 'both')
    expect(resolved.id).toBe(legacy.id)
  })

  it('does not match a legacy (handFilter-less) section against a hand-isolated attempt', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const legacy = await createSection({
      pieceId: piece.id,
      label: 'Measures 1-4',
      startMeasure: 1,
      endMeasure: 4,
      defaultTempoBpm: 80,
    })
    const resolved = await resolveSection(piece.id, range, 80, 'right')
    expect(resolved.id).not.toBe(legacy.id)
    expect(resolved.label).toBe('Measures 1-4 (Right hand)')
  })
})

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
    const section = await resolveSection(piece.id, range, 80, 'both', 'metronome')
    expect(section.label).toBe('Measures 1-4')
    expect(section.handFilter).toBe('both')
  })

  it('labels a hand-isolated section distinctly', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const right = await resolveSection(piece.id, range, 80, 'right', 'metronome')
    const left = await resolveSection(piece.id, range, 80, 'left', 'metronome')
    expect(right.label).toBe('Measures 1-4 (Right hand)')
    expect(left.label).toBe('Measures 1-4 (Left hand)')
  })

  it('labels a Notes-mode section distinctly', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const notes = await resolveSection(piece.id, range, 80, 'both', 'notes')
    expect(notes.label).toBe('Measures 1-4 (Notes)')
    expect(notes.mode).toBe('notes')
  })

  it('reuses an existing section for the same range, hand filter, and mode instead of creating a duplicate', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const first = await resolveSection(piece.id, range, 80, 'both', 'metronome')
    const second = await resolveSection(piece.id, range, 100, 'both', 'metronome')
    expect(second.id).toBe(first.id)
    expect((await listSectionsForPiece(piece.id))).toHaveLength(1)
  })

  it('treats the same range with a different hand filter as a distinct section', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const both = await resolveSection(piece.id, range, 80, 'both', 'metronome')
    const right = await resolveSection(piece.id, range, 80, 'right', 'metronome')
    expect(right.id).not.toBe(both.id)
    expect((await listSectionsForPiece(piece.id))).toHaveLength(2)
  })

  it('treats the same range and hand filter with a different mode as a distinct section', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const metronome = await resolveSection(piece.id, range, 80, 'both', 'metronome')
    const notes = await resolveSection(piece.id, range, 80, 'both', 'notes')
    expect(notes.id).not.toBe(metronome.id)
    expect((await listSectionsForPiece(piece.id))).toHaveLength(2)
  })

  it('treats a legacy section with no stored handFilter/mode as "both"/"metronome", matching a fresh both-hands metronome attempt', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const legacy = await createSection({
      pieceId: piece.id,
      label: 'Measures 1-4',
      startMeasure: 1,
      endMeasure: 4,
      defaultTempoBpm: 80,
    })
    const resolved = await resolveSection(piece.id, range, 80, 'both', 'metronome')
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
    const resolved = await resolveSection(piece.id, range, 80, 'right', 'metronome')
    expect(resolved.id).not.toBe(legacy.id)
    expect(resolved.label).toBe('Measures 1-4 (Right hand)')
  })

  it('does not match a legacy (mode-less) section against a Notes-mode attempt', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const legacy = await createSection({
      pieceId: piece.id,
      label: 'Measures 1-4',
      startMeasure: 1,
      endMeasure: 4,
      defaultTempoBpm: 80,
    })
    const resolved = await resolveSection(piece.id, range, 80, 'both', 'notes')
    expect(resolved.id).not.toBe(legacy.id)
    expect(resolved.label).toBe('Measures 1-4 (Notes)')
  })
})

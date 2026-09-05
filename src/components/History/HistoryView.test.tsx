import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { recordAttempt } from '../../lib/db/attemptsRepo'
import { resetDbConnectionForTests } from '../../lib/db/db'
import { createPiece } from '../../lib/db/piecesRepo'
import { createSection } from '../../lib/db/sectionsRepo'
import { HistoryView } from './HistoryView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const aggregate = {
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

function render(element: React.ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return { container, root }
}

beforeEach(async () => {
  await resetDbConnectionForTests()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('woodshed-v2')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe('HistoryView', () => {
  it('shows attempts across all sections of the piece with section labels', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const opening = await createSection({
      pieceId: piece.id,
      label: 'Measures 1-4',
      startMeasure: 1,
      endMeasure: 4,
      defaultTempoBpm: 80,
    })
    const later = await createSection({
      pieceId: piece.id,
      label: 'Measures 5-8',
      startMeasure: 5,
      endMeasure: 8,
      defaultTempoBpm: 60,
    })
    await recordAttempt({ sectionId: opening.id, pieceId: piece.id, tempoBpm: 80, aborted: false, aggregate, noteResults: [] })
    await recordAttempt({ sectionId: later.id, pieceId: piece.id, tempoBpm: 60, aborted: false, aggregate, noteResults: [] })

    const { container } = render(<HistoryView pieceId={piece.id} refreshKey={0} />)
    await act(async () => {})
    expect(container.textContent).toContain('Measures 1-4')
    expect(container.textContent).toContain('Measures 5-8')
    expect(container.textContent).toContain('80 BPM')
    expect(container.textContent).toContain('60 BPM')
  })

  it('does not show another piece attempts', async () => {
    const piece = await createPiece({ title: 'P', filename: 'p.musicxml', musicXml: '', measureCount: 10 })
    const other = await createPiece({ title: 'Other', filename: 'o.musicxml', musicXml: '', measureCount: 10 })
    const section = await createSection({ pieceId: piece.id, label: 'Opening', startMeasure: 1, endMeasure: 4, defaultTempoBpm: 80 })
    const otherSection = await createSection({ pieceId: other.id, label: 'Other', startMeasure: 1, endMeasure: 2, defaultTempoBpm: 40 })
    await recordAttempt({ sectionId: otherSection.id, pieceId: other.id, tempoBpm: 40, aborted: false, aggregate, noteResults: [] })
    await recordAttempt({ sectionId: section.id, pieceId: piece.id, tempoBpm: 80, aborted: false, aggregate, noteResults: [] })

    const { container } = render(<HistoryView pieceId={piece.id} refreshKey={0} />)
    await act(async () => {})
    expect(container.textContent).toContain('80 BPM')
    expect(container.textContent).not.toContain('40 BPM')
  })
})
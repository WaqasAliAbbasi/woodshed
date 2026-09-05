import { PointF2D, type GraphicalNote, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useEffect, useRef } from 'react'
import { buildExpectedTimeline } from '../../lib/musicxml/buildExpectedTimeline'
import { findMeasureNumberAt } from '../../lib/musicxml/measureHitTest'
import type { MeasureRange } from '../../lib/musicxml/types'
import { useOSMD } from './useOSMD'

const HIGHLIGHT_COLOR = '#3b82f6'
const DEFAULT_NOTE_COLOR = 'black'
/** Tempo doesn't matter here — only graphicalNotes (not onsetSec) is used for highlighting. */
const HIGHLIGHT_TEMPO_BPM = 120

export function ScoreViewer({
  musicXml,
  onReady,
  range,
  clickable,
  onMeasureClick,
}: {
  musicXml: string
  onReady: (osmd: OpenSheetMusicDisplay | undefined) => void
  range: MeasureRange | undefined
  clickable: boolean
  onMeasureClick: (measureNumber: number) => void
}) {
  const { containerRef, osmd, error } = useOSMD(musicXml)
  const highlightedNotesRef = useRef<GraphicalNote[]>([])

  // Read through a ref so the click listener (attached once per osmd
  // instance, below) never needs re-attaching and never goes stale.
  const latestRef = useRef({ clickable, onMeasureClick })
  latestRef.current = { clickable, onMeasureClick }

  useEffect(() => {
    onReady(osmd)
  }, [osmd, onReady])

  useEffect(() => {
    if (!osmd) return
    const container = containerRef.current
    if (!container) return

    const handleClick = (event: MouseEvent) => {
      if (!latestRef.current.clickable) return
      const domPoint = new PointF2D(event.clientX, event.clientY)
      const svgPoint = osmd.GraphicSheet.domToSvg(domPoint)
      const osmdPoint = osmd.GraphicSheet.svgToOsmd(svgPoint)
      const measureNumber = findMeasureNumberAt(osmd, osmdPoint)
      if (measureNumber !== undefined) {
        latestRef.current.onMeasureClick(measureNumber)
      }
    }

    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [osmd, containerRef])

  // Highlight the currently selected range in blue while it's still
  // editable. Depends on start/end as primitives (not `range` identity) so
  // it doesn't refire on every keystroke in the numeric inputs, and is
  // gated on `clickable` so it can never run while an attempt is using the
  // same shared cursor for playback.
  useEffect(() => {
    if (!osmd) return

    for (const note of highlightedNotesRef.current) {
      note.setColor(DEFAULT_NOTE_COLOR, { applyToNoteheads: true })
    }
    highlightedNotesRef.current = []

    if (clickable && range) {
      const notes = buildExpectedTimeline(osmd, range, HIGHLIGHT_TEMPO_BPM).flatMap((e) => e.graphicalNotes)
      for (const note of notes) {
        note.setColor(HIGHLIGHT_COLOR, { applyToNoteheads: true })
      }
      highlightedNotesRef.current = notes
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on start/end primitives, not `range` object identity
  }, [osmd, range?.startMeasure, range?.endMeasure, clickable])

  return (
    <div className={`score-viewer${clickable ? ' score-viewer-clickable' : ''}`}>
      {error && <div className="banner banner-error">Failed to load score: {error}</div>}
      <div ref={containerRef} />
    </div>
  )
}

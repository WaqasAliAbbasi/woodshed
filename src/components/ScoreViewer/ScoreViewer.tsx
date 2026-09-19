import { PointF2D, type GraphicalNote, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useEffect, useRef } from 'react'
import { buildExpectedTimeline, type HandFilter } from '../../lib/musicxml/buildExpectedTimeline'
import { findMeasureNumberAt } from '../../lib/musicxml/measureHitTest'
import type { MeasureRange } from '../../lib/musicxml/types'
import { getAccentColor, getDefaultMusicColor } from '../../lib/theme'
import { MAX_ZOOM, MIN_ZOOM, useOSMD } from './useOSMD'

const ZOOM_STEP = 0.1

/** Tempo doesn't matter here — only graphicalNotes (not onsetSec) is used for highlighting. */
const HIGHLIGHT_TEMPO_BPM = 120

export function ScoreViewer({
  musicXml,
  onReady,
  range,
  clickable,
  onMeasureClick,
  handFilter,
}: {
  musicXml: string
  onReady: (osmd: OpenSheetMusicDisplay | undefined) => void
  range: MeasureRange | undefined
  clickable: boolean
  onMeasureClick: (measureNumber: number) => void
  handFilter: HandFilter
}) {
  const { containerRef, osmd, error, zoom, setZoom, renderVersion } = useOSMD(musicXml)
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

  // Paints the currently selected range in blue — gated on `clickable` so it
  // can't run while an attempt is using the same shared cursor for
  // playback, and keyed on start/end as primitives (not `range` identity) so
  // it doesn't refire on every keystroke in the numeric inputs.
  useEffect(() => {
    if (!osmd) return

    for (const note of highlightedNotesRef.current) {
      note.setColor(getDefaultMusicColor(), { applyToNoteheads: true })
    }
    const paintedNotes: GraphicalNote[] = []

    if (clickable && range) {
      const notes = buildExpectedTimeline(osmd, range, HIGHLIGHT_TEMPO_BPM, handFilter).flatMap((e) => e.graphicalNotes)
      const highlightColor = getAccentColor()
      for (const note of notes) {
        note.setColor(highlightColor, { applyToNoteheads: true })
      }
      paintedNotes.push(...notes)
    }

    highlightedNotesRef.current = paintedNotes
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on start/end primitives, not `range` object identity
  }, [osmd, range?.startMeasure, range?.endMeasure, clickable, handFilter, renderVersion])

  return (
    <div className={`score-viewer panel${clickable ? ' score-viewer-clickable' : ''}`}>
      {error && <div className="banner banner-error">Failed to load score: {error}</div>}
      <div className="zoom-control">
        <button type="button" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(zoom - ZOOM_STEP)}>
          −
        </button>
        <span className="zoom-level">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(zoom + ZOOM_STEP)}>
          +
        </button>
      </div>
      <div ref={containerRef} />
    </div>
  )
}

import { PointF2D, type GraphicalNote, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useEffect, useRef } from 'react'
import { buildExpectedTimeline, type HandFilter } from '../../lib/musicxml/buildExpectedTimeline'
import { findMeasureNumberAt, getMeasureBoundingBoxes } from '../../lib/musicxml/measureHitTest'
import type { MeasureRange } from '../../lib/musicxml/types'
import { getAccentColor, getDefaultMusicColor, getProgressWashColors } from '../../lib/theme'
import { MAX_ZOOM, MIN_ZOOM, useOSMD } from './useOSMD'

const ZOOM_STEP = 0.1

/** Tempo doesn't matter here — only graphicalNotes (not onsetSec) is used for highlighting. */
const HIGHLIGHT_TEMPO_BPM = 120

/** OSMD's own internal unit -> its rendered SVG's coordinate space, confirmed against the (minified, un-exported) `svgToOsmd` implementation, which just does the inverse (`/= 10`). */
const OSMD_UNIT_TO_SVG_PX = 10

const PROGRESS_WASH_CLASS = 'measure-progress-wash'

const WASH_CORNER_RADIUS_PX = 5

export type MeasureProgressStatus = 'ready' | 'inProgress'

export function ScoreViewer({
  musicXml,
  onReady,
  range,
  clickable,
  onMeasureClick,
  handFilter,
  measureStatus,
}: {
  musicXml: string
  onReady: (osmd: OpenSheetMusicDisplay | undefined) => void
  range: MeasureRange | undefined
  clickable: boolean
  onMeasureClick: (measureNumber: number) => void
  handFilter: HandFilter
  /** Per-measure practice status, washed behind the notation — "ready" in green, "inProgress" (attempted but not yet ready) in a neutral tint. Painted regardless of edit/attempt state. */
  measureStatus: ReadonlyMap<number, MeasureProgressStatus>
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

  // Washes each practiced measure's own slice of the score in a faint color
  // — green once "ready", neutral while attempted but not there yet —
  // painted *behind* the notation rather than as a glyph beside it. A
  // measure is a span, not a point: a wash covers exactly the measure and
  // can't collide with fingering, dynamics or slurs the way a mark hunting
  // for free space does. Drawn straight into OSMD's own <svg> (osmd units
  // -> that svg's coordinate space is a fixed *10 scale, see
  // OSMD_UNIT_TO_SVG_PX) so it stays aligned across zoom/reflow without
  // tracking the container's screen position. Always on — unlike the range
  // highlight above, not gated on `clickable` — so "where have I already
  // practiced" stays visible during an attempt too.
  useEffect(() => {
    const container = containerRef.current
    const svg = container?.querySelector('svg')
    if (!svg) return

    for (const wash of svg.querySelectorAll(`.${PROGRESS_WASH_CLASS}`)) wash.remove()
    if (!osmd || measureStatus.size === 0) return

    const boxes = getMeasureBoundingBoxes(osmd)

    // Every wash in a system shares that system's full vertical extent, so a
    // run of them reads as one continuous band instead of stepping up and
    // down with each measure's own annotation height.
    const systemExtent = new Map<number, { top: number; bottom: number }>()
    for (const box of boxes) {
      const extent = systemExtent.get(box.systemIndex)
      if (!extent) systemExtent.set(box.systemIndex, { top: box.top, bottom: box.bottom })
      else {
        extent.top = Math.min(extent.top, box.top)
        extent.bottom = Math.max(extent.bottom, box.bottom)
      }
    }

    // Horizontal span per measure, unioned across the staves it's drawn on.
    const spanByMeasure = new Map<number, { left: number; right: number; systemIndex: number; status: MeasureProgressStatus }>()
    for (const box of boxes) {
      const status = measureStatus.get(box.measureNumber)
      if (!status) continue
      const span = spanByMeasure.get(box.measureNumber)
      if (!span) spanByMeasure.set(box.measureNumber, { left: box.left, right: box.right, systemIndex: box.systemIndex, status })
      else {
        span.left = Math.min(span.left, box.left)
        span.right = Math.max(span.right, box.right)
      }
    }

    // Neighbouring measures of the same status are drawn as one rounded run
    // rather than one rect each: measures tile edge to edge, so per-measure
    // rects would either seam visibly where they meet or notch against each
    // other once rounded. A run also matches how the information is actually
    // read — "these bars are solid", not "bar 5, bar 6, bar 7".
    const runs: { left: number; right: number; systemIndex: number; status: MeasureProgressStatus }[] = []
    for (const span of [...spanByMeasure.values()].sort((a, b) => a.systemIndex - b.systemIndex || a.left - b.left)) {
      const open = runs[runs.length - 1]
      const continues =
        open && open.systemIndex === span.systemIndex && open.status === span.status && Math.abs(span.left - open.right) < 0.01
      if (continues) open.right = Math.max(open.right, span.right)
      else runs.push({ ...span })
    }

    const colors = getProgressWashColors()
    for (const run of runs) {
      const extent = systemExtent.get(run.systemIndex)
      if (!extent) continue

      const wash = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      wash.setAttribute('x', String(run.left * OSMD_UNIT_TO_SVG_PX))
      wash.setAttribute('y', String(extent.top * OSMD_UNIT_TO_SVG_PX))
      wash.setAttribute('width', String((run.right - run.left) * OSMD_UNIT_TO_SVG_PX))
      wash.setAttribute('height', String((extent.bottom - extent.top) * OSMD_UNIT_TO_SVG_PX))
      wash.setAttribute('rx', String(WASH_CORNER_RADIUS_PX))
      wash.setAttribute('fill', run.status === 'ready' ? colors.ready : colors.touched)
      wash.setAttribute('class', PROGRESS_WASH_CLASS)
      wash.setAttribute('pointer-events', 'none')
      // SVG paints in document order, so the first child is furthest back —
      // this keeps the wash under the notation instead of over it.
      svg.insertBefore(wash, svg.firstChild)
    }
  }, [osmd, measureStatus, renderVersion, containerRef])

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

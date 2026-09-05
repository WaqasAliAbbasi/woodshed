import { PointF2D, type GraphicalNote, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useEffect, useRef } from 'react'
import type { SectionProgress } from '../../lib/coach/pieceProgress'
import { buildExpectedTimeline, type HandFilter } from '../../lib/musicxml/buildExpectedTimeline'
import { findMeasureNumberAt } from '../../lib/musicxml/measureHitTest'
import type { MeasureRange } from '../../lib/musicxml/types'
import { CORRECT_COLOR, PROGRESSING_COLOR, WRONG_COLOR, getAccentColor, getDefaultMusicColor } from '../../lib/theme'
import { useOSMD } from './useOSMD'

/** Tempo doesn't matter here — only graphicalNotes (not onsetSec) is used for highlighting. */
const HIGHLIGHT_TEMPO_BPM = 120

const STATUS_COLOR: Record<SectionProgress['status'], string> = {
  struggling: WRONG_COLOR,
  progressing: PROGRESSING_COLOR,
  ready: CORRECT_COLOR,
}

export function ScoreViewer({
  musicXml,
  onReady,
  range,
  clickable,
  onMeasureClick,
  handFilter,
  progress,
  showProgress,
}: {
  musicXml: string
  onReady: (osmd: OpenSheetMusicDisplay | undefined) => void
  range: MeasureRange | undefined
  clickable: boolean
  onMeasureClick: (measureNumber: number) => void
  handFilter: HandFilter
  /** Per-section accuracy summaries for the whole piece, painted as a heatmap when `showProgress` is on. Omit/leave undefined outside a context that tracks progress. */
  progress?: SectionProgress[]
  showProgress?: boolean
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

  // Paints, in order: the progress heatmap (if showing), then the currently
  // selected range in blue on top of it — both gated on `clickable` so
  // neither can run while an attempt is using the same shared cursor for
  // playback, and both share one "previously colored" ref so a range change
  // cleanly restores heatmap-colored notes instead of resetting them to the
  // plain default color. Depends on start/end as primitives (not `range`
  // identity) so it doesn't refire on every keystroke in the numeric inputs.
  useEffect(() => {
    if (!osmd) return

    for (const note of highlightedNotesRef.current) {
      note.setColor(getDefaultMusicColor(), { applyToNoteheads: true })
    }
    const paintedNotes: GraphicalNote[] = []

    if (clickable && showProgress && progress) {
      // Oldest-first, so a more recently created section wins the color for any measures it shares with an older one.
      const byCreatedAt = progress.slice().sort((a, b) => a.section.createdAt - b.section.createdAt)
      for (const { section, status } of byCreatedAt) {
        const sectionRange = { startMeasure: section.startMeasure, endMeasure: section.endMeasure }
        const notes = buildExpectedTimeline(osmd, sectionRange, HIGHLIGHT_TEMPO_BPM, section.handFilter ?? 'both').flatMap(
          (e) => e.graphicalNotes,
        )
        for (const note of notes) {
          note.setColor(STATUS_COLOR[status], { applyToNoteheads: true })
        }
        paintedNotes.push(...notes)
      }
    }

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
  }, [osmd, range?.startMeasure, range?.endMeasure, clickable, handFilter, showProgress, progress])

  return (
    <div className={`score-viewer panel${clickable ? ' score-viewer-clickable' : ''}`}>
      {error && <div className="banner banner-error">Failed to load score: {error}</div>}
      {clickable && showProgress && progress && progress.length > 0 && (
        <div className="progress-legend">
          <span className="progress-legend-item">
            <span className="progress-swatch" style={{ background: STATUS_COLOR.struggling }} /> Struggling
          </span>
          <span className="progress-legend-item">
            <span className="progress-swatch" style={{ background: STATUS_COLOR.progressing }} /> Progressing
          </span>
          <span className="progress-legend-item">
            <span className="progress-swatch" style={{ background: STATUS_COLOR.ready }} /> Ready
          </span>
        </div>
      )}
      <div ref={containerRef} />
    </div>
  )
}

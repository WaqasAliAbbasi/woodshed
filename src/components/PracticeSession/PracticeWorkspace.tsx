import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useCallback, useEffect, useState } from 'react'
import { summarizeSectionProgress, type SectionProgress } from '../../lib/coach/pieceProgress'
import { listAttemptsForPiece } from '../../lib/db/attemptsRepo'
import type { Piece } from '../../lib/db/db'
import { listSectionsForPiece } from '../../lib/db/sectionsRepo'
import { getStaffCount, type HandFilter } from '../../lib/musicxml/buildExpectedTimeline'
import type { MeasureRange } from '../../lib/musicxml/types'
import type { UseMidiInputResult } from '../InputSourceSelector/useMidiInput'
import { ScoreViewer } from '../ScoreViewer/ScoreViewer'
import { PracticeSession } from './PracticeSession'

const DEFAULT_RANGE_LENGTH_MEASURES = 4

/**
 * Owns everything shared between the score view (where clicks happen) and
 * the practice session (where the range is consumed) for one piece —
 * `osmd`/`range`/`anchorMeasure` all live here rather than in App.tsx so
 * they reset for free via unmount on every piece switch, instead of needing
 * hand-written resets in a component that never unmounts.
 */
export function PracticeWorkspace({
  piece,
  midi,
  progressRefreshKey,
  onAttemptRecorded,
}: {
  piece: Piece
  midi: UseMidiInputResult
  /** Bumped by the parent after every recorded attempt, so the progress heatmap picks up the new result. */
  progressRefreshKey: number
  onAttemptRecorded: (sectionId: string) => void
}) {
  const [osmd, setOsmd] = useState<OpenSheetMusicDisplay | undefined>(undefined)
  const [range, setRange] = useState<MeasureRange | undefined>(undefined)
  const [anchorMeasure, setAnchorMeasure] = useState<number | undefined>(undefined)
  const [editable, setEditable] = useState(true)
  const [handFilter, setHandFilter] = useState<HandFilter>('both')
  const [staffCount, setStaffCount] = useState(1)
  const [progress, setProgress] = useState<SectionProgress[]>([])
  const [showProgress, setShowProgress] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([listSectionsForPiece(piece.id), listAttemptsForPiece(piece.id)]).then(([sections, attempts]) => {
      if (cancelled) return
      setProgress(summarizeSectionProgress(sections, attempts))
    })
    return () => {
      cancelled = true
    }
  }, [piece.id, progressRefreshKey])

  // The range is derived from the loaded score once OSMD is ready, so it's
  // initialized in the onReady handler rather than in an effect (which would
  // trigger a cascading render). ScoreViewer is keyed by piece.id, so a new
  // piece remounts it and osmd arrives fresh.
  const handleOsmdReady = useCallback((loaded: OpenSheetMusicDisplay | undefined) => {
    setOsmd(loaded)
    if (loaded && range === undefined) {
      const measures = loaded.Sheet.SourceMeasures
      // Not necessarily 1: a piece that opens with a pickup/anacrusis
      // measure gets that measure numbered 0 by OSMD, not 1 (see
      // buildExpectedTimeline's getSourceMeasure) — defaulting to a
      // hardcoded startMeasure: 1 would silently skip it.
      const firstMeasureNumber = measures[0]?.MeasureNumber ?? 1
      const lastMeasureNumber = measures[measures.length - 1]?.MeasureNumber ?? firstMeasureNumber
      setRange({
        startMeasure: firstMeasureNumber,
        endMeasure: Math.min(firstMeasureNumber + DEFAULT_RANGE_LENGTH_MEASURES - 1, lastMeasureNumber),
      })
      setStaffCount(getStaffCount(loaded))
    }
  }, [range])

  const handleMeasureClick = (measureNumber: number) => {
    if (anchorMeasure === undefined) {
      setAnchorMeasure(measureNumber)
      setRange({ startMeasure: measureNumber, endMeasure: measureNumber })
    } else {
      setRange({ startMeasure: Math.min(anchorMeasure, measureNumber), endMeasure: Math.max(anchorMeasure, measureNumber) })
      setAnchorMeasure(undefined)
    }
  }

  const handleEditableChange = (nextEditable: boolean) => {
    setEditable(nextEditable)
    // Never let a half-made selection (one click, no second click yet)
    // survive into the next time the user is allowed to click again —
    // otherwise their next click silently completes a stale range instead
    // of starting a fresh one.
    if (!nextEditable) setAnchorMeasure(undefined)
  }

  return (
    <>
      {progress.length > 0 && (
        <button type="button" className="progress-toggle" onClick={() => setShowProgress((v) => !v)}>
          {showProgress ? 'Hide progress' : 'Show progress'}
        </button>
      )}
      <ScoreViewer
        key={piece.id}
        musicXml={piece.musicXml}
        onReady={handleOsmdReady}
        range={range}
        clickable={editable}
        onMeasureClick={handleMeasureClick}
        handFilter={handFilter}
        progress={progress}
        showProgress={showProgress}
      />
      {osmd && range && (
        <PracticeSession
          osmd={osmd}
          piece={piece}
          midi={midi}
          range={range}
          handFilter={handFilter}
          onHandFilterChange={setHandFilter}
          staffCount={staffCount}
          onEditableChange={handleEditableChange}
          onAttemptRecorded={onAttemptRecorded}
          progress={progress}
        />
      )}
    </>
  )
}

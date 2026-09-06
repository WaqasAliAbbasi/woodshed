import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { computeMeasureDifficulty, findWorstWindow } from '../../lib/coach/measureDifficulty'
import { summarizeSectionProgress, type SectionProgress } from '../../lib/coach/pieceProgress'
import { listAttemptsForPiece } from '../../lib/db/attemptsRepo'
import type { Attempt, Piece } from '../../lib/db/db'
import { listSectionsForPiece } from '../../lib/db/sectionsRepo'
import { autoChopSections, type CandidateSection } from '../../lib/musicxml/autoChop'
import { getStaffCount, type HandFilter } from '../../lib/musicxml/buildExpectedTimeline'
import type { MeasureRange } from '../../lib/musicxml/types'
import type { PracticeMode } from '../../lib/scoring/types'
import type { UseMidiInputResult } from '../InputSourceSelector/useMidiInput'
import { ScoreViewer } from '../ScoreViewer/ScoreViewer'
import { PracticeSession } from './PracticeSession'

const DEFAULT_RANGE_LENGTH_MEASURES = 4
/** Window size "drill my problem measures" searches for — short enough to isolate the actual trouble spot rather than dragging in a whole surrounding phrase. */
const DRILL_WINDOW_MEASURES = 2

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
  const [mode, setMode] = useState<PracticeMode>('metronome')
  const [staffCount, setStaffCount] = useState(1)
  const [progress, setProgress] = useState<SectionProgress[]>([])
  const [showProgress, setShowProgress] = useState(false)
  const [showMeasureDifficulty, setShowMeasureDifficulty] = useState(false)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [measureBounds, setMeasureBounds] = useState<{ first: number; last: number } | undefined>(undefined)

  const candidateSections = useMemo(
    () => (measureBounds ? autoChopSections(measureBounds.first, measureBounds.last) : []),
    [measureBounds],
  )
  const measureDifficulty = useMemo(() => computeMeasureDifficulty(attempts), [attempts])

  useEffect(() => {
    let cancelled = false
    Promise.all([listSectionsForPiece(piece.id), listAttemptsForPiece(piece.id)]).then(([sections, pieceAttempts]) => {
      if (cancelled) return
      setProgress(summarizeSectionProgress(sections, pieceAttempts))
      setAttempts(pieceAttempts)
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
      setMeasureBounds({ first: firstMeasureNumber, last: lastMeasureNumber })
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

  // A ready-made starting point besides two blind clicks — picks the range
  // and, on a multi-staff piece, defaults to right-hand-first (the
  // RH -> LH -> hands-together drill order; Loop mode's speed-trainer
  // step-up, see practiceMachine, covers the slow -> target tempo axis of
  // that same order once the user turns Loop on).
  const handleSelectCandidateSection = (section: CandidateSection) => {
    setAnchorMeasure(undefined)
    setRange(section.range)
    if (staffCount > 1) setHandFilter('right')
  }

  const handleToggleProgress = () => {
    setShowProgress((v) => !v)
    setShowMeasureDifficulty(false)
  }

  const handleToggleMeasureDifficulty = () => {
    setShowMeasureDifficulty((v) => !v)
    setShowProgress(false)
  }

  // "Drill my problem measures": jump straight to the worst short window
  // instead of hunting for it in the (already fine-grained) difficulty
  // overlay by eye.
  const handleDrillProblemMeasures = () => {
    if (!measureBounds) return
    const worst = findWorstWindow(measureDifficulty, DRILL_WINDOW_MEASURES, measureBounds.first, measureBounds.last)
    if (!worst) return
    setAnchorMeasure(undefined)
    setRange(worst)
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
      <div className="viewer-toolbar">
        {progress.length > 0 && (
          <button type="button" className="progress-toggle" onClick={handleToggleProgress}>
            {showProgress ? 'Hide progress' : 'Show progress'}
          </button>
        )}
        {measureDifficulty.length > 0 && (
          <button type="button" className="progress-toggle" onClick={handleToggleMeasureDifficulty}>
            {showMeasureDifficulty ? 'Hide trouble spots' : 'Show trouble spots'}
          </button>
        )}
        {measureDifficulty.length > 0 && (
          <button type="button" className="progress-toggle" onClick={handleDrillProblemMeasures}>
            Drill my problem measures
          </button>
        )}
      </div>
      {editable && candidateSections.length > 1 && (
        <div className="shelf section-suggestions">
          {candidateSections.map((section) => (
            <button
              key={`${section.range.startMeasure}-${section.range.endMeasure}`}
              type="button"
              className={`tile tile-suggestion${
                range?.startMeasure === section.range.startMeasure && range.endMeasure === section.range.endMeasure ? ' tile-suggestion-active' : ''
              }`}
              onClick={() => handleSelectCandidateSection(section)}
            >
              {section.label}
            </button>
          ))}
        </div>
      )}
      {editable && anchorMeasure !== undefined && <p className="selection-hint">Click the last measure of the range</p>}
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
        measureDifficulty={measureDifficulty}
        showMeasureDifficulty={showMeasureDifficulty}
      />
      {osmd && range && (
        <PracticeSession
          osmd={osmd}
          piece={piece}
          midi={midi}
          range={range}
          handFilter={handFilter}
          onHandFilterChange={setHandFilter}
          mode={mode}
          onModeChange={setMode}
          staffCount={staffCount}
          onEditableChange={handleEditableChange}
          onAttemptRecorded={onAttemptRecorded}
          progress={progress}
        />
      )}
    </>
  )
}

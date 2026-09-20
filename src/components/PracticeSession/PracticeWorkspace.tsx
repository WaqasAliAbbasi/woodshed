import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { summarizeSectionProgress, type SectionProgress } from '../../lib/coach/pieceProgress'
import { listAttemptsForPiece } from '../../lib/db/attemptsRepo'
import type { Piece } from '../../lib/db/db'
import { listSectionsForPiece } from '../../lib/db/sectionsRepo'
import { getDefaultTempoBpm, getStaffCount, type HandFilter } from '../../lib/musicxml/buildExpectedTimeline'
import type { MeasureRange } from '../../lib/musicxml/types'
import type { PracticeMode } from '../../lib/scoring/types'
import type { UseMidiInputResult } from '../InputSourceSelector/useMidiInput'
import { ScoreViewer, type MeasureProgressStatus } from '../ScoreViewer/ScoreViewer'
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
  targetTempoBpm,
  onScoreTempoResolved,
  onEditableChange,
}: {
  piece: Piece
  midi: UseMidiInputResult
  /** Bumped by the parent after every recorded attempt, so the section-progress stamp picks up the new result. */
  progressRefreshKey: number
  onAttemptRecorded: (sectionId: string) => void
  /**
   * The piece's target tempo, resolved by App (the piece's saved value, or
   * the score's own marking until one is set). Undefined only for the
   * render between the score loading and that marking reaching App — the
   * practice deck waits rather than briefly running at a guessed tempo.
   */
  targetTempoBpm: number | undefined
  /** Reports the score's own marked tempo up once OSMD has parsed it — the fallback target, and what the tempo presets are anchored to. Only this component has the loaded score to read it from. */
  onScoreTempoResolved: (bpm: number) => void
  onEditableChange: (editable: boolean) => void
}) {
  const [osmd, setOsmd] = useState<OpenSheetMusicDisplay | undefined>(undefined)
  const [range, setRange] = useState<MeasureRange | undefined>(undefined)
  const [anchorMeasure, setAnchorMeasure] = useState<number | undefined>(undefined)
  const [editable, setEditable] = useState(true)
  const [handFilter, setHandFilter] = useState<HandFilter>('both')
  const [mode, setMode] = useState<PracticeMode>('metronome')
  const [staffCount, setStaffCount] = useState(1)
  const [progress, setProgress] = useState<SectionProgress[]>([])

  // Per-measure shading for every measure covered by a section that's been
  // attempted: green once the section has been played clean at the target
  // tempo, a neutral "worked on, not there yet" tint otherwise. Where two
  // overlapping sections disagree on a measure, cleared wins — getting it
  // in the context of one section is real even if a longer section covering
  // the same measure hasn't come together yet.
  const measureStatus = useMemo(() => {
    const statuses = new Map<number, MeasureProgressStatus>()
    for (const { section, clearedAtTarget } of progress) {
      const mark: MeasureProgressStatus = clearedAtTarget ? 'ready' : 'inProgress'
      for (let m = section.startMeasure; m <= section.endMeasure; m++) {
        if (mark === 'ready' || statuses.get(m) !== 'ready') statuses.set(m, mark)
      }
    }
    return statuses
  }, [progress])

  useEffect(() => {
    let cancelled = false
    Promise.all([listSectionsForPiece(piece.id), listAttemptsForPiece(piece.id)]).then(([sections, pieceAttempts]) => {
      if (cancelled) return
      setProgress(summarizeSectionProgress(sections, pieceAttempts, targetTempoBpm))
    })
    return () => {
      cancelled = true
    }
  }, [piece.id, progressRefreshKey, targetTempoBpm])

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
      onScoreTempoResolved(getDefaultTempoBpm(loaded))
    }
  }, [range, onScoreTempoResolved])

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
    onEditableChange(nextEditable)
    // Never let a half-made selection (one click, no second click yet)
    // survive into the next time the user is allowed to click again —
    // otherwise their next click silently completes a stale range instead
    // of starting a fresh one.
    if (!nextEditable) setAnchorMeasure(undefined)
  }

  return (
    <>
      {editable && anchorMeasure !== undefined && <p className="selection-hint">Click the last measure of the range</p>}
      <ScoreViewer
        key={piece.id}
        musicXml={piece.musicXml}
        onReady={handleOsmdReady}
        range={range}
        clickable={editable}
        onMeasureClick={handleMeasureClick}
        handFilter={handFilter}
        measureStatus={measureStatus}
      />
      {osmd && range && targetTempoBpm !== undefined && (
        <PracticeSession
          osmd={osmd}
          piece={piece}
          midi={midi}
          range={range}
          tempoBpm={targetTempoBpm}
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

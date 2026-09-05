import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useCallback, useState } from 'react'
import type { Piece } from '../../lib/db/db'
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
  onAttemptRecorded,
}: {
  piece: Piece
  midi: UseMidiInputResult
  onAttemptRecorded: (sectionId: string) => void
}) {
  const [osmd, setOsmd] = useState<OpenSheetMusicDisplay | undefined>(undefined)
  const [range, setRange] = useState<MeasureRange | undefined>(undefined)
  const [anchorMeasure, setAnchorMeasure] = useState<number | undefined>(undefined)
  const [editable, setEditable] = useState(true)

  // The range is derived from the loaded score once OSMD is ready, so it's
  // initialized in the onReady handler rather than in an effect (which would
  // trigger a cascading render). ScoreViewer is keyed by piece.id, so a new
  // piece remounts it and osmd arrives fresh.
  const handleOsmdReady = useCallback((loaded: OpenSheetMusicDisplay | undefined) => {
    setOsmd(loaded)
    if (loaded && range === undefined) {
      setRange({ startMeasure: 1, endMeasure: Math.min(DEFAULT_RANGE_LENGTH_MEASURES, loaded.Sheet.SourceMeasures.length) })
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
      <ScoreViewer
        key={piece.id}
        musicXml={piece.musicXml}
        onReady={handleOsmdReady}
        range={range}
        clickable={editable}
        onMeasureClick={handleMeasureClick}
      />
      {osmd && range && (
        <PracticeSession
          osmd={osmd}
          piece={piece}
          midi={midi}
          range={range}
          onEditableChange={handleEditableChange}
          onAttemptRecorded={onAttemptRecorded}
        />
      )}
    </>
  )
}

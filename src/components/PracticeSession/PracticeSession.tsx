import type { GraphicalNote, OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { correlateClock, getAudioContext, midiTimeStampToAudioTime, type ClockCorrelation } from '../../lib/clock/audioClock'
import { Metronome } from '../../lib/clock/metronome'
import { recordAttempt } from '../../lib/db/attemptsRepo'
import type { Piece } from '../../lib/db/db'
import { HAND_LABEL, resolveSection } from '../../lib/db/resolveSection'
import {
  advanceCursorToMeasure,
  buildExpectedTimeline,
  getBeatsPerMeasure,
  getCountInBeats,
  getDefaultTempoBpm,
  getTempoPresets,
  type HandFilter,
} from '../../lib/musicxml/buildExpectedTimeline'
import type { ExpectedChordEvent, MeasureRange } from '../../lib/musicxml/types'
import { ACCEPT_MS, NoteMatcher } from '../../lib/scoring/matcher'
import { CORRECT_COLOR, WRONG_COLOR, getDefaultMusicColor } from '../../lib/theme'
import type { MidiNoteEvent } from '../../lib/midi/midiEvents'
import { HandFilterControl } from '../HandFilterControl/HandFilterControl'
import type { UseMidiInputResult } from '../InputSourceSelector/useMidiInput'
import { TempoControl } from '../TempoControl/TempoControl'
import { initialPracticeState, practiceReducer } from './practiceMachine'

const COUNT_IN_MEASURES = 1
const LOOP_END_GRACE_SEC = 0.5
const LEAD_IN_SEC = 0.15

export function PracticeSession({
  osmd,
  piece,
  midi,
  range,
  handFilter,
  onHandFilterChange,
  staffCount,
  onEditableChange,
  onAttemptRecorded,
}: {
  osmd: OpenSheetMusicDisplay
  piece: Piece
  midi: UseMidiInputResult
  range: MeasureRange
  handFilter: HandFilter
  onHandFilterChange: (handFilter: HandFilter) => void
  /** Pieces with only one staff have nothing to isolate — the hand picker is hidden in that case. */
  staffCount: number
  onEditableChange: (editable: boolean) => void
  onAttemptRecorded: (sectionId: string) => void
}) {
  const [tempoBpm, setTempoBpm] = useState(() => getDefaultTempoBpm(osmd))
  // The piece's own marked tempo, kept separate from `tempoBpm` (which the
  // student can freely change) so the presets stay anchored to a fixed
  // "full speed" target rather than drifting to whatever's currently dialed in.
  const idealTempoBpm = useMemo(() => getDefaultTempoBpm(osmd), [osmd])
  const tempoPresets = useMemo(() => getTempoPresets(idealTempoBpm), [idealTempoBpm])
  const [state, dispatch] = useReducer(practiceReducer, initialPracticeState)
  const [currentBeat, setCurrentBeat] = useState(0)
  const [beatsPerMeasure, setBeatsPerMeasure] = useState(4)

  const sectionIdRef = useRef<string | undefined>(undefined)
  const matcherRef = useRef<NoteMatcher | undefined>(undefined)
  const correlationRef = useRef<ClockCorrelation | undefined>(undefined)
  const loopStartTimeSecRef = useRef<number | undefined>(undefined)
  const eventsRef = useRef<ExpectedChordEvent[]>([])
  const rafRef = useRef<number | undefined>(undefined)
  const nextEventIndexRef = useRef(0)
  const lastShownMeasureRef = useRef<number | undefined>(undefined)
  /** Notes colored green/red this attempt — reset to black at the start of the next one. */
  const coloredNotesRef = useRef<GraphicalNote[]>([])

  const editable = state.status === 'PieceLoaded' || state.status === 'SectionConfigured'

  // Keep the reducer's copy of range/tempo/hand-filter in sync while the user can still edit them.
  useEffect(() => {
    if (editable) dispatch({ type: 'configureSection', range, tempoBpm, handFilter })
  }, [range, tempoBpm, handFilter, editable])

  // Feed MIDI note-on events into the active matcher only while actually attempting.
  useEffect(() => {
    if (state.status !== 'Attempting') {
      midi.setNoteHandler(() => {})
      return
    }
    midi.setNoteHandler((event: MidiNoteEvent) => {
      if (event.type !== 'noteOn') return
      const matcher = matcherRef.current
      const correlation = correlationRef.current
      const loopStartTimeSec = loopStartTimeSecRef.current
      if (!matcher || !correlation || loopStartTimeSec === undefined) return
      const audioTimeSec = midiTimeStampToAudioTime(correlation, event.timeStampMs)
      const result = matcher.noteOn(event.note, audioTimeSec - loopStartTimeSec)
      if (result.graphicalNote) {
        result.graphicalNote.setColor(CORRECT_COLOR, { applyToNoteheads: true })
        coloredNotesRef.current.push(result.graphicalNote)
      }
    })
    return () => midi.setNoteHandler(() => {})
  }, [state.status, midi])

  // CountingIn + Attempting: one continuous metronome (audible click + beat
  // indicator) spanning both phases — it used to stop right as playing
  // began, which is why there was silence during the actual attempt.
  //
  // The expected timeline/matcher are also built here, at CountingIn's
  // start, rather than waiting for Attempting to begin: if the user hits
  // Stop during the count-in, the state machine goes straight from
  // CountingIn to AttemptScoring without ever entering Attempting, and
  // AttemptScoring's effect needs a matcher to finalize (finalize() then
  // correctly reports "everything missed" — the honest score for an
  // attempt stopped before anything was played — instead of getting stuck
  // forever with no matcher to work with).
  useEffect(() => {
    if (state.status !== 'CountingIn' && state.status !== 'Attempting') return
    const audioContext = getAudioContext()
    void audioContext.resume()
    correlationRef.current = correlateClock(audioContext)

    for (const note of coloredNotesRef.current) {
      note.setColor(getDefaultMusicColor(), { applyToNoteheads: true })
    }
    coloredNotesRef.current = []
    const events = buildExpectedTimeline(osmd, state.range, state.tempoBpm, state.handFilter)
    eventsRef.current = events
    matcherRef.current = new NoteMatcher(events)
    nextEventIndexRef.current = 0
    lastShownMeasureRef.current = undefined

    const measureBeats = getBeatsPerMeasure(osmd, state.range.startMeasure)
    setBeatsPerMeasure(measureBeats)
    const countInBeats = getCountInBeats(osmd, state.range.startMeasure, COUNT_IN_MEASURES)

    const metronome = new Metronome(audioContext, state.tempoBpm, measureBeats)
    metronome.start(audioContext.currentTime + LEAD_IN_SEC, (beatIndex, timeSec) => {
      setCurrentBeat(beatIndex % measureBeats)
      if (beatIndex === countInBeats) {
        loopStartTimeSecRef.current = timeSec
        dispatch({ type: 'countInDone' })
      }
    })
    return () => metronome.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per running phase (CountingIn through Attempting); range/tempo are frozen by the reducer until AttemptComplete
  }, [state.status === 'CountingIn' || state.status === 'Attempting', osmd])

  // Attempting: drive the live matcher's clock (missed-note sweeps) and measure-level cursor sync.
  // The timeline/matcher themselves are already built (see the effect above).
  useEffect(() => {
    if (state.status !== 'Attempting') return
    const audioContext = getAudioContext()
    const events = eventsRef.current

    advanceCursorToMeasure(osmd, state.range.startMeasure)
    osmd.cursor.show()

    const loopStartTimeSec = loopStartTimeSecRef.current ?? audioContext.currentTime
    const lastOnset = events.length > 0 ? events[events.length - 1].onsetSec : 0
    const loopEndTimeSec = loopStartTimeSec + lastOnset + ACCEPT_MS / 1000 + LOOP_END_GRACE_SEC

    const tick = () => {
      const elapsedSec = audioContext.currentTime - loopStartTimeSec
      const newlyMissed = matcherRef.current?.sweepMissed(elapsedSec) ?? []
      for (const result of newlyMissed) {
        if (result.graphicalNote) {
          result.graphicalNote.setColor(WRONG_COLOR, { applyToNoteheads: true })
          coloredNotesRef.current.push(result.graphicalNote)
        }
      }

      while (nextEventIndexRef.current < events.length && events[nextEventIndexRef.current].onsetSec <= elapsedSec) {
        const measureNumber = events[nextEventIndexRef.current].measureNumber
        if (measureNumber !== lastShownMeasureRef.current) {
          advanceCursorToMeasure(osmd, measureNumber)
          lastShownMeasureRef.current = measureNumber
        }
        nextEventIndexRef.current++
      }

      if (audioContext.currentTime >= loopEndTimeSec) {
        dispatch({ type: 'loopEndReached' })
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current)
      osmd.cursor.hide()
    }
  }, [state.status, osmd]) // eslint-disable-line react-hooks/exhaustive-deps -- fires once on entering Attempting; range/tempo are frozen by the reducer until AttemptComplete

  // AttemptScoring: finalize the matcher, persist the attempt, hand off to AttemptComplete.
  useEffect(() => {
    if (state.status !== 'AttemptScoring') return
    const matcher = matcherRef.current
    const sectionId = sectionIdRef.current
    if (!matcher || !sectionId) return
    const { aggregate, noteResults } = matcher.finalize()

    // Safety-net coloring pass: covers notes the live tick loop didn't get
    // to (e.g. the attempt was stopped early, before sweepMissed caught
    // everything). Harmless to redundantly recolor notes already colored live.
    for (const result of noteResults) {
      if (result.graphicalNote) {
        result.graphicalNote.setColor(result.classification === 'missed' ? WRONG_COLOR : CORRECT_COLOR, {
          applyToNoteheads: true,
        })
        coloredNotesRef.current.push(result.graphicalNote)
      }
    }

    void recordAttempt({
      sectionId,
      pieceId: piece.id,
      tempoBpm: state.tempoBpm,
      aborted: state.aborted,
      aggregate,
      noteResults: noteResults.map(({ graphicalNote: _graphicalNote, ...stored }) => stored),
    }).then(() => {
      onAttemptRecorded(sectionId)
      dispatch({ type: 'attemptScored', aggregate })
    })
  }, [state.status, piece.id, onAttemptRecorded]) // eslint-disable-line react-hooks/exhaustive-deps -- fires once on entering AttemptScoring, closing over that render's state

  const handleStart = async () => {
    if (state.status !== 'SectionConfigured') return
    onEditableChange(false)
    const section = await resolveSection(piece.id, state.range, state.tempoBpm, state.handFilter)
    sectionIdRef.current = section.id
    dispatch({ type: 'start' })
  }

  const handleAdjust = () => {
    onEditableChange(true)
    dispatch({ type: 'adjust' })
  }

  const handleDone = () => {
    onEditableChange(true)
    dispatch({ type: 'done' })
  }

  return (
    <div className="practice-session">
      <div className="practice-action-bar">
        <div className="practice-controls">
          <span className="practice-section-label">
            Measures {range.startMeasure}–{range.endMeasure}
            {HAND_LABEL[handFilter]}
          </span>

          {(state.status === 'CountingIn' || state.status === 'Attempting') && (
            <>
              <div className="beat-indicator">
                {Array.from({ length: beatsPerMeasure }, (_, i) => (
                  <span key={i} className={`beat-dot${i === currentBeat ? ' beat-dot-active' : ''}`} />
                ))}
              </div>
              {state.status === 'CountingIn' && <span className="practice-status">Count-in…</span>}
              {state.status === 'Attempting' && <span className="practice-status">Playing…</span>}
            </>
          )}

          <TempoControl tempoBpm={tempoBpm} onChange={setTempoBpm} disabled={!editable} presets={tempoPresets} />

          {staffCount > 1 && (
            <HandFilterControl handFilter={handFilter} onChange={onHandFilterChange} disabled={!editable} />
          )}

          {state.status === 'SectionConfigured' && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleStart()}
              disabled={!midi.connected}
            >
              Start
            </button>
          )}
          {(state.status === 'CountingIn' || state.status === 'Attempting') && (
            <button type="button" onClick={() => dispatch({ type: 'stop' })}>
              Stop
            </button>
          )}
          {state.status === 'AttemptComplete' && (
            <>
              <div className="practice-result-summary">
                {state.aborted && (
                  <span className="banner banner-warning practice-result-aborted">Stopped early</span>
                )}
                {state.aggregate.expected === 0 ? (
                  <span className="practice-result-text">
                    No {handFilter === 'both' ? '' : `${handFilter}-hand `}notes in this section — try a different range
                    or hand.
                  </span>
                ) : (
                  <span className="practice-result-text">
                    Pitch {Math.round(state.aggregate.pitchAccuracy * 100)}% · Timing{' '}
                    {Math.round(state.aggregate.timingAccuracy * 100)}% · {state.aggregate.correct}/
                    {state.aggregate.expected} notes · {state.aggregate.missed} missed · {state.aggregate.extra} wrong ·{' '}
                    {state.aggregate.onTime} on / {state.aggregate.early} early / {state.aggregate.late} late
                  </span>
                )}
              </div>
              <button type="button" onClick={() => dispatch({ type: 'repeat' })}>
                Repeat
              </button>
              <button type="button" onClick={handleAdjust}>
                Change section
              </button>
              <button type="button" onClick={handleDone}>
                Done
              </button>
            </>
          )}
          {!midi.connected && state.status === 'SectionConfigured' && (
            <span className="practice-hint">Connect a MIDI device to start practicing.</span>
          )}
        </div>
      </div>
    </div>
  )
}

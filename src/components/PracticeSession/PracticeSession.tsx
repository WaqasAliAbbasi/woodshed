import type { GraphicalNote, OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { correlateClock, getAudioContext, midiTimeStampToAudioTime, type ClockCorrelation } from '../../lib/clock/audioClock'
import { Metronome } from '../../lib/clock/metronome'
import { isReadyToStopLooping, SECTION_STATUS_LABEL } from '../../lib/coach/suggestNextStep'
import type { SectionProgress } from '../../lib/coach/pieceProgress'
import { recordAttempt } from '../../lib/db/attemptsRepo'
import type { Piece } from '../../lib/db/db'
import { HAND_LABEL, MODE_LABEL, resolveSection } from '../../lib/db/resolveSection'
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
import { SequenceMatcher } from '../../lib/scoring/sequenceMatcher'
import type { PracticeMode } from '../../lib/scoring/types'
import { CORRECT_COLOR, WRONG_COLOR, getDefaultMusicColor } from '../../lib/theme'
import type { MidiNoteEvent } from '../../lib/midi/midiEvents'
import { HandFilterControl } from '../HandFilterControl/HandFilterControl'
import type { UseMidiInputResult } from '../InputSourceSelector/useMidiInput'
import { PracticeModeControl } from '../PracticeModeControl/PracticeModeControl'
import { TempoControl } from '../TempoControl/TempoControl'
import { initialPracticeState, practiceReducer } from './practiceMachine'

const COUNT_IN_MEASURES = 1
const LOOP_END_GRACE_SEC = 0.5
const LEAD_IN_SEC = 0.15
/** Pause after an attempt finishes before Loop mode auto-repeats — long enough to glance at the result, short enough to keep drilling. */
const LOOP_REPEAT_DELAY_MS = 1500

export function PracticeSession({
  osmd,
  piece,
  midi,
  range,
  handFilter,
  onHandFilterChange,
  mode,
  onModeChange,
  staffCount,
  onEditableChange,
  onAttemptRecorded,
  progress,
}: {
  osmd: OpenSheetMusicDisplay
  piece: Piece
  midi: UseMidiInputResult
  range: MeasureRange
  handFilter: HandFilter
  onHandFilterChange: (handFilter: HandFilter) => void
  mode: PracticeMode
  onModeChange: (mode: PracticeMode) => void
  /** Pieces with only one staff have nothing to isolate — the hand picker is hidden in that case. */
  staffCount: number
  onEditableChange: (editable: boolean) => void
  onAttemptRecorded: (sectionId: string) => void
  /** Looked up (by the just-completed section's id) to stamp the result with its overall struggling/progressing/ready status — not derived from this one attempt alone. */
  progress: SectionProgress[]
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
  const [loopEnabled, setLoopEnabled] = useState(false)

  const sectionIdRef = useRef<string | undefined>(undefined)
  const matcherRef = useRef<NoteMatcher | undefined>(undefined)
  const sequenceMatcherRef = useRef<SequenceMatcher | undefined>(undefined)
  const correlationRef = useRef<ClockCorrelation | undefined>(undefined)
  const loopStartTimeSecRef = useRef<number | undefined>(undefined)
  const eventsRef = useRef<ExpectedChordEvent[]>([])
  const attemptStartWallClockRef = useRef<number | undefined>(undefined)
  const rafRef = useRef<number | undefined>(undefined)
  const nextEventIndexRef = useRef(0)
  const lastShownMeasureRef = useRef<number | undefined>(undefined)
  /** Notes colored green/red this attempt — reset to black at the start of the next one. */
  const coloredNotesRef = useRef<GraphicalNote[]>([])
  const deckRef = useRef<HTMLDivElement>(null)

  const editable = state.status === 'PieceLoaded' || state.status === 'SectionConfigured'

  // The fixed deck's height varies with practice state (idle controls, result
  // stats, the loop toggle — plus wrapping on narrow screens), so a fixed
  // page bottom-padding guess drifts out of sync and lets the deck cover
  // page content like the practice log. Measure it and feed it back as a CSS
  // var that .app's padding-bottom is built from instead (see App.css).
  useEffect(() => {
    const deck = deckRef.current
    if (!deck) return
    const setHeightVar = () => {
      document.documentElement.style.setProperty('--practice-deck-height', `${deck.offsetHeight}px`)
    }
    setHeightVar()
    const observer = new ResizeObserver(setHeightVar)
    observer.observe(deck)
    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--practice-deck-height')
    }
  }, [])

  // Keep the reducer's copy of range/tempo/hand-filter/mode in sync while the user can still edit them.
  useEffect(() => {
    if (editable) dispatch({ type: 'configureSection', range, tempoBpm, handFilter, mode })
  }, [range, tempoBpm, handFilter, mode, editable])

  // Feed MIDI note-on events into the active matcher only while actually attempting.
  useEffect(() => {
    if (state.status !== 'Attempting') {
      midi.setNoteHandler(() => {})
      return
    }
    const mode = state.mode

    midi.setNoteHandler((event: MidiNoteEvent) => {
      if (event.type !== 'noteOn') return

      if (mode === 'notes') {
        const sequenceMatcher = sequenceMatcherRef.current
        if (!sequenceMatcher) return
        const result = sequenceMatcher.noteOn(event.note, event.velocity)

        if (result.classification === 'extra') {
          // Wrong note: flash what's actually expected right now so it's clear what to try instead — see SequenceMatcher's drill-style design (must play it correctly to advance).
          for (const graphicalNote of sequenceMatcher.currentRemainingGraphicalNotes) {
            graphicalNote.setColor(WRONG_COLOR, { applyToNoteheads: true })
            coloredNotesRef.current.push(graphicalNote)
          }
          return
        }

        if (result.graphicalNote) {
          result.graphicalNote.setColor(CORRECT_COLOR, { applyToNoteheads: true })
          coloredNotesRef.current.push(result.graphicalNote)
        }

        if (sequenceMatcher.isComplete) {
          dispatch({ type: 'loopEndReached' })
          return
        }
        const measureNumber = sequenceMatcher.currentChord?.measureNumber
        if (measureNumber !== undefined && measureNumber !== lastShownMeasureRef.current) {
          advanceCursorToMeasure(osmd, measureNumber)
          lastShownMeasureRef.current = measureNumber
        }
        return
      }

      const matcher = matcherRef.current
      const correlation = correlationRef.current
      const loopStartTimeSec = loopStartTimeSecRef.current
      if (!matcher || !correlation || loopStartTimeSec === undefined) return
      const audioTimeSec = midiTimeStampToAudioTime(correlation, event.timeStampMs)
      const result = matcher.noteOn(event.note, audioTimeSec - loopStartTimeSec, event.velocity)
      if (result.graphicalNote) {
        result.graphicalNote.setColor(CORRECT_COLOR, { applyToNoteheads: true })
        coloredNotesRef.current.push(result.graphicalNote)
      }
    })
    return () => midi.setNoteHandler(() => {})
  }, [state.status, midi, osmd]) // eslint-disable-line react-hooks/exhaustive-deps -- fires once on entering Attempting; mode/range are frozen by the reducer until AttemptComplete

  // CountingIn + Attempting, Metronome mode only: one continuous metronome
  // (audible click + beat indicator) spanning both phases — it used to stop
  // right as playing began, which is why there was silence during the
  // actual attempt. Notes mode has no tempo to click against — see the
  // separate effect below for its (much simpler) setup.
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
    if (state.mode !== 'metronome') return
    attemptStartWallClockRef.current = Date.now()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per running phase (CountingIn through Attempting); range/tempo/mode are frozen by the reducer until AttemptComplete
  }, [(state.status === 'CountingIn' || state.status === 'Attempting') && state.mode === 'metronome', osmd])

  // Attempting, Notes mode only: build the sequence matcher and show the
  // cursor at the start of the range. No count-in, no clock — the passage
  // only advances when the right note is actually played (see the MIDI
  // note-on effect above and SequenceMatcher).
  useEffect(() => {
    if (state.status !== 'Attempting') return
    if (state.mode !== 'notes') return
    attemptStartWallClockRef.current = Date.now()

    for (const note of coloredNotesRef.current) {
      note.setColor(getDefaultMusicColor(), { applyToNoteheads: true })
    }
    coloredNotesRef.current = []
    const events = buildExpectedTimeline(osmd, state.range, state.tempoBpm, state.handFilter)
    eventsRef.current = events
    sequenceMatcherRef.current = new SequenceMatcher(events)
    lastShownMeasureRef.current = state.range.startMeasure

    advanceCursorToMeasure(osmd, state.range.startMeasure)
    osmd.cursor.show()
    return () => osmd.cursor.hide()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once on entering Attempting in Notes mode; range/hand are frozen by the reducer until AttemptComplete
  }, [state.status === 'Attempting' && state.mode === 'notes', osmd])

  // Attempting, Metronome mode only: drive the live matcher's clock
  // (missed-note sweeps) and measure-level cursor sync. The timeline/matcher
  // themselves are already built (see the effect above). Notes mode needs
  // none of this — its cursor/completion are driven synchronously by each
  // note played, in the MIDI note-on effect above.
  useEffect(() => {
    if (state.status !== 'Attempting') return
    if (state.mode !== 'metronome') return
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
  }, [state.status, osmd]) // eslint-disable-line react-hooks/exhaustive-deps -- fires once on entering Attempting; range/tempo/mode are frozen by the reducer until AttemptComplete

  // AttemptScoring: finalize whichever matcher this attempt used, persist the attempt, hand off to AttemptComplete.
  useEffect(() => {
    if (state.status !== 'AttemptScoring') return
    const activeMatcher = state.mode === 'notes' ? sequenceMatcherRef.current : matcherRef.current
    const sectionId = sectionIdRef.current
    if (!activeMatcher || !sectionId) return
    const { aggregate, noteResults } = activeMatcher.finalize()

    // Safety-net coloring pass: covers notes the live tick loop/note handler
    // didn't get to (e.g. the attempt was stopped early). Harmless to
    // redundantly recolor notes already colored live.
    for (const result of noteResults) {
      if (result.graphicalNote) {
        result.graphicalNote.setColor(result.classification === 'missed' ? WRONG_COLOR : CORRECT_COLOR, {
          applyToNoteheads: true,
        })
        coloredNotesRef.current.push(result.graphicalNote)
      }
    }

    const durationMs = attemptStartWallClockRef.current !== undefined ? Date.now() - attemptStartWallClockRef.current : 0

    void recordAttempt({
      sectionId,
      pieceId: piece.id,
      tempoBpm: state.tempoBpm,
      aborted: state.aborted,
      aggregate,
      durationMs,
      noteResults: noteResults.map(({ graphicalNote: _graphicalNote, ...stored }) => stored),
    }).then(() => {
      onAttemptRecorded(sectionId)
      dispatch({ type: 'attemptScored', aggregate })
    })
  }, [state.status, piece.id, onAttemptRecorded]) // eslint-disable-line react-hooks/exhaustive-deps -- fires once on entering AttemptScoring, closing over that render's state

  // Loop mode: auto-repeat until the section is ready to stop (see
  // isReadyToStopLooping) or the user stops it. Stopping an attempt early
  // (aborted) is treated as "I want out" and turns the loop off rather than
  // immediately restarting, since that's the only way to interrupt a loop.
  useEffect(() => {
    if (!loopEnabled || state.status !== 'AttemptComplete') return
    if (state.aborted) {
      setLoopEnabled(false)
      return
    }
    if (state.aggregate.expected === 0) return // nothing playable in this range/hand combo — nothing to loop toward
    if (isReadyToStopLooping(state.mode, state.aggregate)) {
      setLoopEnabled(false)
      return
    }
    const timeout = setTimeout(() => dispatch({ type: 'repeat' }), LOOP_REPEAT_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [state, loopEnabled])

  const handleStart = async () => {
    if (state.status !== 'SectionConfigured') return
    onEditableChange(false)
    const section = await resolveSection(piece.id, state.range, state.tempoBpm, state.handFilter, state.mode)
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

  const isLive = state.status === 'CountingIn' || state.status === 'Attempting'
  // Swings fully left at the downbeat and fully right at the last beat of the measure — a single
  // real-time readout of where the audio clock actually is, not a decorative loop of its own.
  const needleAngle = isLive && beatsPerMeasure > 1 ? -24 + (currentBeat / (beatsPerMeasure - 1)) * 48 : 0
  // Only meaningful once this attempt's section has a rolled-up status from the *whole* practice
  // history (not just this one attempt) — may briefly be undefined right after scoring, until the
  // progress summary above has refetched to include this attempt.
  const sectionStatus =
    state.status === 'AttemptComplete'
      ? progress.find((p) => p.section.id === sectionIdRef.current)?.status
      : undefined
  const handBalance = state.status === 'AttemptComplete' ? state.aggregate.handBalance : undefined
  // Rounded so the two segments always sum to exactly 100% (avoids a hairline gap or overlap from rounding each independently).
  const leftBalancePct = handBalance
    ? Math.round((100 * handBalance.leftAvgVelocity) / (handBalance.leftAvgVelocity + handBalance.rightAvgVelocity))
    : 0
  const showLoopToggle = state.status === 'SectionConfigured' || state.status === 'AttemptComplete'

  return (
    <div className="practice-session">
      <div className="practice-action-bar">
        <div className="deck" ref={deckRef}>
          <div className="deck-row">
            <span className="practice-section-label">
              Measures {range.startMeasure}–{range.endMeasure}
              {HAND_LABEL[handFilter]}
              {MODE_LABEL[mode]}
            </span>
            {mode === 'metronome' && (
              <div className={`metronome${isLive ? ' metronome-live' : ''}`}>
                <div className="metronome-base" />
                <div className="metronome-needle" style={{ transform: `rotate(${needleAngle}deg)` }} />
                <div className="metronome-ticks">
                  {Array.from({ length: beatsPerMeasure }, (_, i) => (
                    <span key={i} className={`metronome-tick${isLive && i === currentBeat ? ' metronome-tick-active' : ''}`} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {editable && (
            <div className="deck-row deck-idle-controls">
              {mode === 'metronome' && (
                <TempoControl tempoBpm={tempoBpm} onChange={setTempoBpm} disabled={!editable} presets={tempoPresets} />
              )}
              <PracticeModeControl mode={mode} onChange={onModeChange} disabled={!editable} />
              {staffCount > 1 && (
                <HandFilterControl handFilter={handFilter} onChange={onHandFilterChange} disabled={!editable} />
              )}
            </div>
          )}

          {isLive && (
            <div className="deck-row deck-status-text">
              <span className="status-word">
                {state.status === 'CountingIn' ? 'Count-in…' : 'Playing…'}
                {loopEnabled && ' · Looping'}
              </span>
            </div>
          )}

          {state.status === 'AttemptComplete' && (
            <div className="deck-row deck-result">
              {state.aborted && <span className="banner banner-warning practice-result-aborted">Stopped early</span>}
              {state.aggregate.expected === 0 ? (
                <span className="practice-result-text">
                  No {handFilter === 'both' ? '' : `${handFilter}-hand `}notes in this section — try a different range
                  or hand.
                </span>
              ) : (
                <>
                  <div className="stat">
                    <span className="stat-label">Pitch</span>
                    <span className="stat-value">{Math.round(state.aggregate.pitchAccuracy * 100)}%</span>
                    <span className="stat-bar">
                      <span style={{ width: `${Math.round(state.aggregate.pitchAccuracy * 100)}%` }} />
                    </span>
                  </div>
                  {mode === 'metronome' && (
                    <div className="stat">
                      <span className="stat-label">Timing</span>
                      <span className="stat-value">{Math.round(state.aggregate.timingAccuracy * 100)}%</span>
                      <span className="stat-bar stat-bar-timing">
                        <span style={{ width: `${Math.round(state.aggregate.timingAccuracy * 100)}%` }} />
                      </span>
                    </div>
                  )}
                  {handBalance && (
                    <div className="stat">
                      <span className="stat-label">Balance</span>
                      <span className="stat-value">
                        L {Math.round(handBalance.leftAvgVelocity)} · R {Math.round(handBalance.rightAvgVelocity)}
                      </span>
                      <span className="stat-bar stat-bar-balance">
                        <span className="stat-bar-balance-left" style={{ width: `${leftBalancePct}%` }} />
                        <span className="stat-bar-balance-right" style={{ width: `${100 - leftBalancePct}%` }} />
                      </span>
                    </div>
                  )}
                  {sectionStatus && <div className={`stamp stamp-${sectionStatus}`}>{SECTION_STATUS_LABEL[sectionStatus]}</div>}
                  <p className="tally">
                    {state.aggregate.correct}/{state.aggregate.expected} notes · {state.aggregate.missed} missed ·{' '}
                    {state.aggregate.extra} wrong
                    {mode === 'metronome' && (
                      <>
                        {' '}
                        · {state.aggregate.onTime} on / {state.aggregate.early} early / {state.aggregate.late} late
                      </>
                    )}
                  </p>
                </>
              )}
            </div>
          )}

          {showLoopToggle && (
            <label className="loop-toggle">
              <input type="checkbox" checked={loopEnabled} onChange={(e) => setLoopEnabled(e.target.checked)} />
              Loop until ready
            </label>
          )}

          <div className="deck-row deck-actions">
            {state.status === 'SectionConfigured' && (
              <button
                type="button"
                className="btn-primary btn-round"
                onClick={() => void handleStart()}
                disabled={!midi.connected}
              >
                Start
              </button>
            )}
            {isLive && (
              <button type="button" className="btn-round" onClick={() => dispatch({ type: 'stop' })}>
                Stop
              </button>
            )}
            {state.status === 'AttemptComplete' && (
              <div className="result-actions">
                <button type="button" onClick={() => dispatch({ type: 'repeat' })}>
                  Repeat
                </button>
                <button type="button" onClick={handleAdjust}>
                  Change section
                </button>
                <button type="button" className="btn-primary" onClick={handleDone}>
                  Done
                </button>
              </div>
            )}
            {!midi.connected && state.status === 'SectionConfigured' && (
              <span className="practice-hint">Connect a MIDI device to start practicing.</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

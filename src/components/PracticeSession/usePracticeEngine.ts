import type { GraphicalNote, OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useEffect, useReducer, useRef, useState } from 'react'
import { correlateClock, getAudioContext, midiTimeStampToAudioTime, type ClockCorrelation } from '../../lib/clock/audioClock'
import { Metronome } from '../../lib/clock/metronome'
import { Playback } from '../../lib/clock/playback'
import { recordAttempt } from '../../lib/db/attemptsRepo'
import type { Attempt } from '../../lib/db/db'
import {
  advanceCursorToMeasure,
  buildExpectedTimeline,
  getBeatsPerMeasure,
  getCountInBeats,
  scrollCursorIntoView,
  type HandFilter,
} from '../../lib/musicxml/buildExpectedTimeline'
import type { ExpectedChordEvent, MeasureRange } from '../../lib/musicxml/types'
import { ACCEPT_MS, NoteMatcher } from '../../lib/scoring/matcher'
import { SequenceMatcher } from '../../lib/scoring/sequenceMatcher'
import type { NoteClassification, PracticeMode } from '../../lib/scoring/types'
import type { MidiNoteEvent } from '../../lib/midi/midiEvents'
import { CORRECT_COLOR, MISTIMED_COLOR, WRONG_COLOR, getDefaultMusicColor } from '../../lib/theme'
import type { UseMidiInputResult } from '../InputSourceSelector/useMidiInput'
import { initialPracticeState, practiceReducer } from './practiceMachine'

const COUNT_IN_MEASURES = 1
const LOOP_END_GRACE_SEC = 0.5
const LEAD_IN_SEC = 0.15

/** 'extra' is unreachable here — a wrong note has no graphicalNote to color (see NoteResult.graphicalNote) — but every classification still needs an entry to keep this a total function. */
const CLASSIFICATION_COLOR: Record<NoteClassification, string> = {
  onTime: CORRECT_COLOR,
  early: MISTIMED_COLOR,
  late: MISTIMED_COLOR,
  missed: WRONG_COLOR,
  extra: WRONG_COLOR,
}

export interface AttemptSettings {
  range: MeasureRange
  tempoBpm: number
  handFilter: HandFilter
  mode: PracticeMode
}

/**
 * Everything that runs one scored attempt: the practice state machine, the
 * metronome and count-in, feeding MIDI into the right matcher, coloring the
 * score, and recording the result. Shared by Free practice
 * (`PracticeSession`, which wraps it in its deck UI) and the learning path's
 * step screen, so both score exactly the same way.
 *
 * `settings`, when given, is kept in sync with the reducer while it's idle
 * — Free practice's editable controls. The path passes none and starts each
 * try with `begin(settings)` instead.
 */
export function usePracticeEngine({
  osmd,
  pieceId,
  midi,
  settings,
  resolveSectionId,
  onAttemptRecorded,
}: {
  /** Undefined until the score has rendered; nothing can start before then. */
  osmd: OpenSheetMusicDisplay | undefined
  pieceId: string
  midi: UseMidiInputResult
  settings?: AttemptSettings
  /** Finds or creates the section this attempt is stored under. */
  resolveSectionId: (settings: AttemptSettings) => Promise<string>
  onAttemptRecorded: (sectionId: string, attempt: Attempt) => void
}) {
  const [state, dispatch] = useReducer(practiceReducer, initialPracticeState)
  const [currentBeat, setCurrentBeat] = useState(0)
  const [beatsPerMeasure, setBeatsPerMeasure] = useState(4)
  const [isPlayingBack, setIsPlayingBack] = useState(false)

  const sectionIdRef = useRef<string | undefined>(undefined)
  const playbackRef = useRef<Playback | undefined>(undefined)
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

  const editable = state.status === 'PieceLoaded' || state.status === 'SectionConfigured'

  // Keep the reducer's copy of range/tempo/hand-filter/mode in sync while the user can still edit them.
  const range = settings?.range
  const tempoBpm = settings?.tempoBpm
  const handFilter = settings?.handFilter
  const mode = settings?.mode
  useEffect(() => {
    if (editable && range && tempoBpm !== undefined && handFilter && mode) {
      dispatch({ type: 'configureSection', range, tempoBpm, handFilter, mode })
    }
  }, [range, tempoBpm, handFilter, mode, editable])

  // Feed MIDI note-on events into the active matcher only while actually attempting.
  useEffect(() => {
    if (state.status !== 'Attempting' || !osmd) {
      midi.setNoteHandler(() => {})
      return
    }
    const mode = state.mode

    midi.setNoteHandler((event: MidiNoteEvent) => {
      if (event.type !== 'noteOn') return

      if (mode === 'notes') {
        const sequenceMatcher = sequenceMatcherRef.current
        if (!sequenceMatcher) return
        const result = sequenceMatcher.noteOn(event.note, event.timeStampMs, event.velocity)

        if (result.classification === 'extra') {
          // Wrong note: the matcher has just restarted the chord, so this
          // flashes the whole thing red — including any note of it already
          // played green — making it clear the chord starts over rather than
          // resuming from the hand that landed (see SequenceMatcher's
          // all-or-nothing chord rule).
          for (const graphicalNote of sequenceMatcher.currentRemainingGraphicalNotes) {
            graphicalNote.setColor(WRONG_COLOR, { applyToNoteheads: true })
            coloredNotesRef.current.push(graphicalNote)
          }
          return
        }

        // Repaint the whole chord in progress from the matcher's state
        // rather than just greening the note that arrived: this note may
        // have landed too late to belong to the chord its predecessors
        // started (see CHORD_WINDOW_MS), in which case the matcher has just
        // thrown those away and their green has to come off with them —
        // otherwise the score shows credit the matcher didn't give. It also
        // clears the red from an earlier fumble on this chord, which is
        // stale the moment a fresh run at it is under way.
        for (const graphicalNote of sequenceMatcher.currentRemainingGraphicalNotes) {
          graphicalNote.setColor(getDefaultMusicColor(), { applyToNoteheads: true })
        }
        for (const graphicalNote of sequenceMatcher.currentChordGraphicalNotes) {
          graphicalNote.setColor(CORRECT_COLOR, { applyToNoteheads: true })
          coloredNotesRef.current.push(graphicalNote)
        }
        // The note that *completed* a chord is no longer "in progress" by
        // the time we get here — the matcher has already moved on to the
        // next one — so it's colored on its own.
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
          scrollCursorIntoView(osmd)
          lastShownMeasureRef.current = measureNumber
        }
        return
      }

      // Metronome mode: score the note but don't color it live — the player
      // should stay engrossed in the music, not watch the score for
      // right/wrong as they go. Coloring happens all at once when the
      // attempt finishes (see the AttemptScoring effect below).
      const matcher = matcherRef.current
      const correlation = correlationRef.current
      const loopStartTimeSec = loopStartTimeSecRef.current
      if (!matcher || !correlation || loopStartTimeSec === undefined) return
      const audioTimeSec = midiTimeStampToAudioTime(correlation, event.timeStampMs)
      matcher.noteOn(event.note, audioTimeSec - loopStartTimeSec, event.velocity)
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
    if (state.mode !== 'metronome' || !osmd) return
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
    // countInBeats can be fractional (a pickup starting mid-beat, e.g. on
    // "the and" of beat 3 — see getCountInBeats), but the click track only
    // ticks on whole beats. Trigger on the last whole-beat click before the
    // target and land loopStartTimeSecRef the leftover fraction later,
    // rather than snapping to the nearest click and mistiming every note in
    // the attempt by however much got rounded away.
    const countInWholeBeats = Math.floor(countInBeats)
    const countInFractionSec = (countInBeats - countInWholeBeats) * (60 / state.tempoBpm)

    const metronome = new Metronome(audioContext, state.tempoBpm, measureBeats)
    metronome.start(audioContext.currentTime + LEAD_IN_SEC, (beatIndex, timeSec) => {
      setCurrentBeat(beatIndex % measureBeats)
      if (beatIndex === countInWholeBeats) {
        loopStartTimeSecRef.current = timeSec + countInFractionSec
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
    if (state.mode !== 'notes' || !osmd) return
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
    scrollCursorIntoView(osmd)
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
    if (state.mode !== 'metronome' || !osmd) return
    const audioContext = getAudioContext()
    const events = eventsRef.current

    advanceCursorToMeasure(osmd, state.range.startMeasure)
    osmd.cursor.show()
    scrollCursorIntoView(osmd)

    const loopStartTimeSec = loopStartTimeSecRef.current ?? audioContext.currentTime
    const lastOnset = events.length > 0 ? events[events.length - 1].onsetSec : 0
    const loopEndTimeSec = loopStartTimeSec + lastOnset + ACCEPT_MS / 1000 + LOOP_END_GRACE_SEC

    const tick = () => {
      const elapsedSec = audioContext.currentTime - loopStartTimeSec
      // Sweep for scoring only — missed notes are colored all at once at the
      // end of the attempt (see the AttemptScoring effect below), not live.
      matcherRef.current?.sweepMissed(elapsedSec)

      while (nextEventIndexRef.current < events.length && events[nextEventIndexRef.current].onsetSec <= elapsedSec) {
        const measureNumber = events[nextEventIndexRef.current].measureNumber
        if (measureNumber !== lastShownMeasureRef.current) {
          advanceCursorToMeasure(osmd, measureNumber)
          scrollCursorIntoView(osmd)
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

    // Metronome mode's only coloring pass (it deliberately doesn't color
    // live — see the note handler and tick loop above) and Notes mode's
    // safety net for notes the live handler didn't get to (e.g. the attempt
    // was stopped early). Harmless to redundantly recolor notes already
    // colored live.
    for (const result of noteResults) {
      if (result.graphicalNote) {
        result.graphicalNote.setColor(CLASSIFICATION_COLOR[result.classification], { applyToNoteheads: true })
        coloredNotesRef.current.push(result.graphicalNote)
      }
    }

    const durationMs = attemptStartWallClockRef.current !== undefined ? Date.now() - attemptStartWallClockRef.current : 0

    void recordAttempt({
      sectionId,
      pieceId,
      tempoBpm: state.tempoBpm,
      aborted: state.aborted,
      aggregate,
      durationMs,
      noteResults: noteResults.map(({ graphicalNote: _graphicalNote, ...stored }) => stored),
    }).then((attempt) => {
      onAttemptRecorded(sectionId, attempt)
      dispatch({ type: 'attemptScored', aggregate })
    })
  }, [state.status, pieceId, onAttemptRecorded]) // eslint-disable-line react-hooks/exhaustive-deps -- fires once on entering AttemptScoring, closing over that render's state

  // Stop any in-flight playback if the component unmounts mid-playback (e.g. switching pieces).
  useEffect(() => {
    return () => playbackRef.current?.stop()
  }, [])

  const stopPlayback = () => {
    playbackRef.current?.stop()
    setIsPlayingBack(false)
  }

  /** Free practice's Start: the reducer already holds the settings (see the sync effect above). */
  const start = async () => {
    if (state.status !== 'SectionConfigured' || !osmd) return
    stopPlayback()
    const { range, tempoBpm, handFilter, mode } = state
    sectionIdRef.current = await resolveSectionId({ range, tempoBpm, handFilter, mode })
    dispatch({ type: 'start' })
  }

  /** The path's Play: start a try with exactly these settings, from idle or from a result. */
  const begin = async (next: AttemptSettings) => {
    if (!osmd) return
    stopPlayback()
    sectionIdRef.current = await resolveSectionId(next)
    dispatch({ type: 'begin', ...next })
  }

  // Reference playback: hear the range (at the chosen tempo/hand filter)
  // before attempting it — modelling the target sound, which otherwise
  // nothing in the app does besides the metronome click. Reuses
  // buildExpectedTimeline verbatim, same as the matchers do, so playback and
  // scoring always agree on what the range actually contains.
  const playRange = (play: AttemptSettings) => {
    if (!osmd) return
    const audioContext = getAudioContext()
    void audioContext.resume()
    const events = buildExpectedTimeline(osmd, play.range, play.tempoBpm, play.handFilter)
    playbackRef.current?.stop()
    const playback = new Playback(audioContext)
    playbackRef.current = playback
    setIsPlayingBack(true)
    playback.start(events, audioContext.currentTime + LEAD_IN_SEC, () => setIsPlayingBack(false))
  }

  return {
    state,
    dispatch,
    editable,
    currentBeat,
    beatsPerMeasure,
    isPlayingBack,
    isLive: state.status === 'CountingIn' || state.status === 'Attempting',
    /** The section the latest attempt was recorded under. */
    sectionId: sectionIdRef.current,
    start,
    begin,
    playRange,
    stopPlayback,
  }
}

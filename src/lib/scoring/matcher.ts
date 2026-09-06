import type { ExpectedChordEvent } from '../musicxml/types'
import { aggregate } from './aggregate'
import { toMultiset, type RemainingNote } from './noteMultiset'
import type { AttemptAggregate, NoteResult } from './types'

/** Within this many ms of the expected onset, timing counts as "on time". */
export const ON_TIME_MS = 60
/** Beyond this many ms from the expected onset, a pitch match doesn't count as being "for" that event at all. */
export const ACCEPT_MS = 180

interface OpenEvent {
  onsetSec: number
  measureNumber: number
  remaining: Map<number, RemainingNote[]>
}

/**
 * Live-matches incoming MIDI note-on events against a fixed expected
 * timeline. Both `noteOn` and `sweepMissed` are driven externally by the
 * caller's clock (see clock/audioClock.ts) — this class holds no timer of
 * its own.
 */
export class NoteMatcher {
  private readonly openEvents: OpenEvent[]
  private readonly totalExpected: number
  private readonly results: NoteResult[] = []
  private finalized = false

  constructor(events: ExpectedChordEvent[]) {
    this.openEvents = events.map((e) => ({
      onsetSec: e.onsetSec,
      measureNumber: e.measureNumber,
      remaining: toMultiset(e.midiNumbers, e.graphicalNotes, e.hands),
    }))
    this.totalExpected = events.reduce((sum, e) => sum + e.midiNumbers.length, 0)
  }

  /** Record an incoming MIDI Note-On at `timeSec` (audio-clock seconds, see clock/audioClock.ts). `velocity` (0-127) feeds the post-attempt hand-balance metric — see HandBalance. */
  noteOn(midi: number, timeSec: number, velocity?: number): NoteResult {
    const acceptSec = ACCEPT_MS / 1000
    let best: OpenEvent | undefined
    let bestDeltaSec = Infinity

    for (const event of this.openEvents) {
      const remainingForPitch = event.remaining.get(midi)
      if (!remainingForPitch || remainingForPitch.length === 0) continue
      const deltaSec = timeSec - event.onsetSec
      if (Math.abs(deltaSec) <= acceptSec && Math.abs(deltaSec) < Math.abs(bestDeltaSec)) {
        best = event
        bestDeltaSec = deltaSec
      }
    }

    let result: NoteResult
    if (best) {
      const remainingForPitch = best.remaining.get(midi)!
      const popped = remainingForPitch.pop()
      if (remainingForPitch.length === 0) {
        best.remaining.delete(midi)
      }
      const deltaMs = bestDeltaSec * 1000
      result = {
        expectedMidi: midi,
        expectedOnsetSec: best.onsetSec,
        actualMidi: midi,
        actualTimeSec: timeSec,
        classification: Math.abs(deltaMs) <= ON_TIME_MS ? 'onTime' : deltaMs < 0 ? 'early' : 'late',
        deltaMs,
        velocity,
        hand: popped?.hand,
        graphicalNote: popped?.graphicalNote,
      }
    } else {
      result = { actualMidi: midi, actualTimeSec: timeSec, classification: 'extra', velocity }
    }

    this.results.push(result)
    return result
  }

  /** Finalize any events whose acceptance window has fully closed by `nowSec`, marking unmatched pitches as missed. */
  sweepMissed(nowSec: number): NoteResult[] {
    const acceptSec = ACCEPT_MS / 1000
    const newlyMissed: NoteResult[] = []

    for (const event of this.openEvents) {
      if (event.remaining.size === 0) continue
      if (nowSec - event.onsetSec <= acceptSec) continue

      for (const [midi, remainingNotes] of event.remaining) {
        for (const { graphicalNote, hand } of remainingNotes) {
          const result: NoteResult = {
            expectedMidi: midi,
            expectedOnsetSec: event.onsetSec,
            classification: 'missed',
            graphicalNote,
            hand,
          }
          this.results.push(result)
          newlyMissed.push(result)
        }
      }
      event.remaining.clear()
    }

    return newlyMissed
  }

  /** Ends the attempt: force-closes any still-open events as missed (regardless of timing) and returns the final tally. */
  finalize(): { aggregate: AttemptAggregate; noteResults: NoteResult[] } {
    if (!this.finalized) {
      this.sweepMissed(Number.POSITIVE_INFINITY)
      this.finalized = true
    }
    return { aggregate: aggregate(this.results, this.totalExpected), noteResults: this.results }
  }
}

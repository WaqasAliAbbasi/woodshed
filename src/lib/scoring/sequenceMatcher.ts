import type { GraphicalNote } from 'opensheetmusicdisplay'
import type { ExpectedChordEvent } from '../musicxml/types'
import { aggregate } from './aggregate'
import { toMultiset, type RemainingNote } from './noteMultiset'
import type { AttemptAggregate, NoteResult } from './types'

/**
 * Untimed note-reading matcher for Notes mode (see PracticeMode): no clock,
 * no acceptance window — chords are expected strictly in order, and a wrong
 * note is flagged but does *not* advance past the current chord. You must
 * play the correct note(s) to move on, by design (a drill for note accuracy,
 * not a lenient sight-reading check) — see docs discussion that settled on
 * this over "flag and continue".
 */
export class SequenceMatcher {
  private readonly events: ExpectedChordEvent[]
  private readonly totalExpected: number
  private readonly results: NoteResult[] = []
  private chordIndex = 0
  private remaining: Map<number, RemainingNote[]>
  private finalized = false

  constructor(events: ExpectedChordEvent[]) {
    this.events = events
    this.totalExpected = events.reduce((sum, e) => sum + e.midiNumbers.length, 0)
    this.remaining = this.multisetFor(0)
  }

  private multisetFor(index: number): Map<number, RemainingNote[]> {
    const event = this.events[index]
    return event ? toMultiset(event.midiNumbers, event.graphicalNotes, event.hands) : new Map()
  }

  /** True once every chord in the range has been played correctly. */
  get isComplete(): boolean {
    return this.chordIndex >= this.events.length
  }

  /** The chord currently being waited on, or undefined once isComplete. */
  get currentChord(): ExpectedChordEvent | undefined {
    return this.events[this.chordIndex]
  }

  /** Graphical notes in the current chord not yet correctly played — for flashing "try again" feedback on a wrong note without re-coloring notes in the same chord already played correctly. */
  get currentRemainingGraphicalNotes(): GraphicalNote[] {
    return Array.from(this.remaining.values()).flatMap((notes) => notes.map((n) => n.graphicalNote))
  }

  /** Record an incoming MIDI Note-On. `velocity` (0-127) feeds the post-attempt hand-balance metric — see HandBalance. */
  noteOn(midi: number, velocity?: number): NoteResult {
    const remainingForPitch = this.remaining.get(midi)
    if (!remainingForPitch || remainingForPitch.length === 0) {
      const result: NoteResult = { actualMidi: midi, classification: 'extra', velocity, measureNumber: this.currentChord?.measureNumber }
      this.results.push(result)
      return result
    }

    const popped = remainingForPitch.pop()!
    if (remainingForPitch.length === 0) this.remaining.delete(midi)

    const result: NoteResult = {
      expectedMidi: midi,
      actualMidi: midi,
      classification: 'onTime',
      velocity,
      hand: popped.hand,
      graphicalNote: popped.graphicalNote,
      measureNumber: this.currentChord?.measureNumber,
    }
    this.results.push(result)

    if (this.remaining.size === 0) {
      this.chordIndex++
      this.remaining = this.multisetFor(this.chordIndex)
    }

    return result
  }

  /** Ends the attempt: the current chord's unplayed notes (if stopped partway through one) plus every chord after it count as missed. */
  finalize(): { aggregate: AttemptAggregate; noteResults: NoteResult[] } {
    if (!this.finalized) {
      const currentMeasureNumber = this.currentChord?.measureNumber
      for (const [midi, notes] of this.remaining) {
        for (const { graphicalNote, hand } of notes) {
          this.results.push({ expectedMidi: midi, classification: 'missed', graphicalNote, hand, measureNumber: currentMeasureNumber })
        }
      }
      for (let i = this.chordIndex + 1; i < this.events.length; i++) {
        const measureNumber = this.events[i].measureNumber
        for (const [midi, notes] of this.multisetFor(i)) {
          for (const { graphicalNote, hand } of notes) {
            this.results.push({ expectedMidi: midi, classification: 'missed', graphicalNote, hand, measureNumber })
          }
        }
      }
      this.finalized = true
    }
    return { aggregate: aggregate(this.results, this.totalExpected), noteResults: this.results }
  }
}

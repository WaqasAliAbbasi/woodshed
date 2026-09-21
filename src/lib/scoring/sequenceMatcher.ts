import type { GraphicalNote } from 'opensheetmusicdisplay'
import type { ExpectedChordEvent } from '../musicxml/types'
import { aggregate } from './aggregate'
import { toMultiset, type RemainingNote } from './noteMultiset'
import type { AttemptAggregate, NoteResult } from './types'

/**
 * How long after the first note of a chord the rest of it may still arrive
 * and count as part of it. Past this, the chord in progress is thrown away
 * and the next note starts it over.
 *
 * Notes mode has no clock to play *against* — this is not a timing score,
 * and nothing here is judged early or late. It exists only to make
 * "together" mean something: without it, the all-or-nothing chord rule below
 * is satisfied by playing the left hand, thinking about it, and playing the
 * right hand whenever, which is the hands-apart habit the rule is there to
 * prevent. Deliberately loose — wide enough that an ordinary spread or
 * slightly rolled chord still lands as one, since the point is to rule out
 * assembling a chord a hand at a time, not to grade evenness.
 */
const CHORD_WINDOW_MS = 250

/**
 * Untimed note-reading matcher for Notes mode (see PracticeMode): no clock,
 * nothing expected at a moment in time — chords are expected strictly in
 * order, and a wrong note is flagged but does *not* advance past the current
 * chord. You must
 * play the correct note(s) to move on, by design (a drill for note accuracy,
 * not a lenient sight-reading check) — see docs discussion that settled on
 * this over "flag and continue".
 *
 * A chord is all-or-nothing: notes played correctly within it are held back
 * until the whole chord lands, and either a wrong note or a lapsed chord
 * window (see CHORD_WINDOW_MS) throws that partial progress away so the
 * chord has to be played again from scratch. Otherwise a grand-staff chord
 * effectively scores each hand separately — land the left, then take as long
 * as you like to find the right one, and it still counts, which is not what
 * "play this chord" means and quietly trains the hands apart.
 */
export class SequenceMatcher {
  private readonly events: ExpectedChordEvent[]
  private readonly totalExpected: number
  private readonly results: NoteResult[] = []
  /** Correct notes of the chord in progress, not yet committed to `results` — flushed when the chord completes, dropped if a wrong note resets it. */
  private chordResults: NoteResult[] = []
  /** When the chord in progress was started (the timestamp of its first correct note), or undefined when no chord is part-played — see CHORD_WINDOW_MS. */
  private chordStartedAtMs: number | undefined
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

  /** Graphical notes in the current chord not yet correctly played — what "try again" feedback flashes. After a chord restarts that's the whole chord again (see noteOn), so a half-played chord's green notes get repainted along with the rest. */
  get currentRemainingGraphicalNotes(): GraphicalNote[] {
    return Array.from(this.remaining.values()).flatMap((notes) => notes.map((n) => n.graphicalNote))
  }

  /** Graphical notes of the chord in progress already played correctly but not yet credited (its remaining notes haven't landed). Together with {@link currentRemainingGraphicalNotes} this is the whole live state of the current chord, which is what per-note feedback repaints from — see PracticeSession. */
  get currentChordGraphicalNotes(): GraphicalNote[] {
    return this.chordResults.map((r) => r.graphicalNote).filter((n): n is GraphicalNote => n !== undefined)
  }

  /** Throws away the chord in progress: the notes played into it go uncredited (they're never added to `results`) and every note of it has to be played again. */
  private restartChord(): void {
    this.chordResults = []
    this.chordStartedAtMs = undefined
    this.remaining = this.multisetFor(this.chordIndex)
  }

  /** Record an incoming MIDI Note-On at `timeStampMs` (the event's own `performance.now()` timestamp — only ever compared against other note-ons, never against a clock the music runs on). `velocity` (0-127) feeds the post-attempt hand-balance metric — see HandBalance. */
  noteOn(midi: number, timeStampMs: number, velocity?: number): NoteResult {
    // A chord whose window has lapsed is dropped *before* this note is
    // matched, so the note starts the chord afresh instead of completing one
    // that was left half-played — see CHORD_WINDOW_MS.
    if (this.chordStartedAtMs !== undefined && timeStampMs - this.chordStartedAtMs > CHORD_WINDOW_MS) this.restartChord()

    const remainingForPitch = this.remaining.get(midi)
    if (!remainingForPitch || remainingForPitch.length === 0) {
      const result: NoteResult = { actualMidi: midi, classification: 'extra', velocity, measureNumber: this.currentChord?.measureNumber }
      this.results.push(result)
      // Start the chord over rather than crediting the notes already played
      // in it — see the all-or-nothing note in this class's doc.
      this.restartChord()
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
    this.chordResults.push(result)
    this.chordStartedAtMs ??= timeStampMs

    if (this.remaining.size === 0) {
      this.results.push(...this.chordResults)
      this.chordResults = []
      this.chordStartedAtMs = undefined
      this.chordIndex++
      this.remaining = this.multisetFor(this.chordIndex)
    }

    return result
  }

  /**
   * Ends the attempt: the chord in progress plus every chord after it count
   * as missed. A chord stopped partway through counts as missed *in full*,
   * including the notes that were played correctly — the same all-or-nothing
   * rule a wrong note follows, so an abort can't bank half a chord.
   */
  finalize(): { aggregate: AttemptAggregate; noteResults: NoteResult[] } {
    if (!this.finalized) {
      this.restartChord()
      for (let i = this.chordIndex; i < this.events.length; i++) {
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

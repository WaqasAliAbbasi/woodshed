import type { GraphicalNote } from 'opensheetmusicdisplay'

export interface ExpectedChordEvent {
  /** Seconds from the start of the selected practice range, at the chosen practice tempo. */
  onsetSec: number
  /** Duration of the longest note in the chord, in seconds. Informational only in v1 (not scored). */
  durationSec: number
  /** Simultaneous expected MIDI note numbers. */
  midiNumbers: number[]
  /** Parallel to midiNumbers — the on-screen note each pitch corresponds to, for coloring feedback. */
  graphicalNotes: GraphicalNote[]
  /** 1-indexed measure number this chord belongs to, for UI highlighting. */
  measureNumber: number
}

export interface MeasureRange {
  startMeasure: number
  endMeasure: number
}

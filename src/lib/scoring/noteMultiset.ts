import type { GraphicalNote } from 'opensheetmusicdisplay'
import type { Hand } from './types'

export interface RemainingNote {
  graphicalNote: GraphicalNote
  hand: Hand
}

/** Shared by NoteMatcher and SequenceMatcher: midi note number -> stack of unmatched notes for that pitch (a chord can double a pitch across voices/hands). */
export function toMultiset(midiNumbers: number[], graphicalNotes: GraphicalNote[], hands: Hand[]): Map<number, RemainingNote[]> {
  const map = new Map<number, RemainingNote[]>()
  midiNumbers.forEach((midi, i) => {
    const stack = map.get(midi) ?? []
    stack.push({ graphicalNote: graphicalNotes[i], hand: hands[i] })
    map.set(midi, stack)
  })
  return map
}

import type { GraphicalNote } from 'opensheetmusicdisplay'

export type NoteClassification = 'onTime' | 'early' | 'late' | 'missed' | 'extra'

export interface NoteResult {
  expectedMidi?: number
  expectedOnsetSec?: number
  actualMidi?: number
  actualTimeSec?: number
  classification: NoteClassification
  deltaMs?: number
  /**
   * The on-screen note to color for live feedback. Present for onTime/early/
   * late/missed (all tie to a specific expected note); absent for extra (a
   * wrong note played has no score position to color). Not persisted — see
   * `StoredNoteResult`, which strips this before writing to IndexedDB, since
   * GraphicalNote instances aren't structured-clone-safe.
   */
  graphicalNote?: GraphicalNote
}

/** `NoteResult` minus the live-only `graphicalNote` reference — what actually gets persisted. */
export type StoredNoteResult = Omit<NoteResult, 'graphicalNote'>

export interface AttemptAggregate {
  expected: number
  correct: number
  missed: number
  extra: number
  onTime: number
  early: number
  late: number
  /** correct / expected. 0 when nothing was expected. */
  pitchAccuracy: number
  /** onTime / correct. 0 when nothing was matched correctly. */
  timingAccuracy: number
}

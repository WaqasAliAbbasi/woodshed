import type { GraphicalNote } from 'opensheetmusicdisplay'

export type NoteClassification = 'onTime' | 'early' | 'late' | 'missed' | 'extra'

export type Hand = 'left' | 'right'

/**
 * 'metronome' is today's tempo-locked practice: count-in, click track, notes
 * scored against a fixed-time expected timeline (see NoteMatcher). 'notes' is
 * untimed reading practice: no metronome, no tempo — the passage advances
 * only when you actually play the right note (see SequenceMatcher), so you
 * can focus on pitch accuracy before adding tempo pressure.
 */
export type PracticeMode = 'metronome' | 'notes'

export interface NoteResult {
  expectedMidi?: number
  expectedOnsetSec?: number
  actualMidi?: number
  actualTimeSec?: number
  classification: NoteClassification
  deltaMs?: number
  /** MIDI velocity (0-127) of the actual note-on. Present whenever a note was actually played (onTime/early/late/extra); absent for missed (never played). */
  velocity?: number
  /** Which hand's expected note this was, by staff position (see buildExpectedTimeline's noteHand). Present whenever this result ties to an expected note (onTime/early/late/missed); absent for extra (no expected note to attribute a hand to). */
  hand?: Hand
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

/** Average note-on velocity per hand across an attempt's correctly-matched notes — a loudness balance check, not a pitch/timing one. */
export interface HandBalance {
  leftAvgVelocity: number
  rightAvgVelocity: number
  leftNoteCount: number
  rightNoteCount: number
}

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
  /** Undefined when there's nothing to compare — hands-separate practice, a single-staff piece, or no velocity data (e.g. virtual keyboard, which sends a fixed velocity). */
  handBalance?: HandBalance
}

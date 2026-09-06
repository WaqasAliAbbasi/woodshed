import type { HandFilter } from '../../lib/musicxml/buildExpectedTimeline'
import type { MeasureRange } from '../../lib/musicxml/types'
import type { AttemptAggregate, PracticeMode } from '../../lib/scoring/types'

export type PracticeState =
  | { status: 'PieceLoaded' }
  | { status: 'SectionConfigured'; range: MeasureRange; tempoBpm: number; handFilter: HandFilter; mode: PracticeMode }
  | { status: 'CountingIn'; range: MeasureRange; tempoBpm: number; handFilter: HandFilter; mode: PracticeMode }
  | { status: 'Attempting'; range: MeasureRange; tempoBpm: number; handFilter: HandFilter; mode: PracticeMode }
  | {
      status: 'AttemptScoring'
      range: MeasureRange
      tempoBpm: number
      handFilter: HandFilter
      mode: PracticeMode
      aborted: boolean
    }
  | {
      status: 'AttemptComplete'
      range: MeasureRange
      tempoBpm: number
      handFilter: HandFilter
      mode: PracticeMode
      aborted: boolean
      aggregate: AttemptAggregate
    }

export type PracticeEvent =
  | { type: 'configureSection'; range: MeasureRange; tempoBpm: number; handFilter: HandFilter; mode: PracticeMode }
  | { type: 'start' }
  | { type: 'countInDone' }
  | { type: 'loopEndReached' }
  | { type: 'stop' }
  | { type: 'attemptScored'; aggregate: AttemptAggregate }
  /** `tempoBpm`, when given, overrides the just-completed attempt's tempo — Loop mode's speed-trainer step-up (see PracticeSession) bumping to the next preset on a passing rep. Omitted for a same-tempo repeat (failing rep, or the user's own "repeat" action). */
  | { type: 'repeat'; tempoBpm?: number }
  | { type: 'adjust' }
  | { type: 'done' }

export const initialPracticeState: PracticeState = { status: 'PieceLoaded' }

/**
 * Notes mode has no tempo/click to count in to (see PracticeMode) — starting
 * or repeating an attempt goes straight to Attempting, skipping CountingIn
 * entirely, instead of running a count-in against a tempo that doesn't apply.
 */
function startingState(
  range: MeasureRange,
  tempoBpm: number,
  handFilter: HandFilter,
  mode: PracticeMode,
): PracticeState {
  return mode === 'notes'
    ? { status: 'Attempting', range, tempoBpm, handFilter, mode }
    : { status: 'CountingIn', range, tempoBpm, handFilter, mode }
}

/**
 * No `Paused` state on purpose: "Stop" always finalizes the current attempt
 * (optionally aborted) rather than resuming a suspended audio clock later —
 * mid-attempt pause/resume is a real source of subtle timing bugs for little
 * payoff at POC stage.
 */
export function practiceReducer(state: PracticeState, event: PracticeEvent): PracticeState {
  switch (state.status) {
    case 'PieceLoaded':
      if (event.type === 'configureSection') {
        return {
          status: 'SectionConfigured',
          range: event.range,
          tempoBpm: event.tempoBpm,
          handFilter: event.handFilter,
          mode: event.mode,
        }
      }
      return state

    case 'SectionConfigured':
      if (event.type === 'configureSection') {
        return {
          status: 'SectionConfigured',
          range: event.range,
          tempoBpm: event.tempoBpm,
          handFilter: event.handFilter,
          mode: event.mode,
        }
      }
      if (event.type === 'start') {
        return startingState(state.range, state.tempoBpm, state.handFilter, state.mode)
      }
      return state

    case 'CountingIn':
      if (event.type === 'countInDone') {
        return { status: 'Attempting', range: state.range, tempoBpm: state.tempoBpm, handFilter: state.handFilter, mode: state.mode }
      }
      if (event.type === 'stop') {
        return {
          status: 'AttemptScoring',
          range: state.range,
          tempoBpm: state.tempoBpm,
          handFilter: state.handFilter,
          mode: state.mode,
          aborted: true,
        }
      }
      return state

    case 'Attempting':
      if (event.type === 'loopEndReached') {
        return {
          status: 'AttemptScoring',
          range: state.range,
          tempoBpm: state.tempoBpm,
          handFilter: state.handFilter,
          mode: state.mode,
          aborted: false,
        }
      }
      if (event.type === 'stop') {
        return {
          status: 'AttemptScoring',
          range: state.range,
          tempoBpm: state.tempoBpm,
          handFilter: state.handFilter,
          mode: state.mode,
          aborted: true,
        }
      }
      return state

    case 'AttemptScoring':
      if (event.type === 'attemptScored') {
        return {
          status: 'AttemptComplete',
          range: state.range,
          tempoBpm: state.tempoBpm,
          handFilter: state.handFilter,
          mode: state.mode,
          aborted: state.aborted,
          aggregate: event.aggregate,
        }
      }
      return state

    case 'AttemptComplete':
      if (event.type === 'repeat') {
        return startingState(state.range, event.tempoBpm ?? state.tempoBpm, state.handFilter, state.mode)
      }
      if (event.type === 'adjust') {
        return {
          status: 'SectionConfigured',
          range: state.range,
          tempoBpm: state.tempoBpm,
          handFilter: state.handFilter,
          mode: state.mode,
        }
      }
      if (event.type === 'done') {
        return { status: 'PieceLoaded' }
      }
      return state
  }
}

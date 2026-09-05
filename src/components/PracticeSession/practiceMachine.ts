import type { MeasureRange } from '../../lib/musicxml/types'
import type { AttemptAggregate } from '../../lib/scoring/types'

export type PracticeState =
  | { status: 'PieceLoaded' }
  | { status: 'SectionConfigured'; range: MeasureRange; tempoBpm: number }
  | { status: 'CountingIn'; range: MeasureRange; tempoBpm: number }
  | { status: 'Attempting'; range: MeasureRange; tempoBpm: number }
  | { status: 'AttemptScoring'; range: MeasureRange; tempoBpm: number; aborted: boolean }
  | { status: 'AttemptComplete'; range: MeasureRange; tempoBpm: number; aborted: boolean; aggregate: AttemptAggregate }

export type PracticeEvent =
  | { type: 'configureSection'; range: MeasureRange; tempoBpm: number }
  | { type: 'start' }
  | { type: 'countInDone' }
  | { type: 'loopEndReached' }
  | { type: 'stop' }
  | { type: 'attemptScored'; aggregate: AttemptAggregate }
  | { type: 'repeat' }
  | { type: 'adjust' }
  | { type: 'done' }

export const initialPracticeState: PracticeState = { status: 'PieceLoaded' }

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
        return { status: 'SectionConfigured', range: event.range, tempoBpm: event.tempoBpm }
      }
      return state

    case 'SectionConfigured':
      if (event.type === 'configureSection') {
        return { status: 'SectionConfigured', range: event.range, tempoBpm: event.tempoBpm }
      }
      if (event.type === 'start') {
        return { status: 'CountingIn', range: state.range, tempoBpm: state.tempoBpm }
      }
      return state

    case 'CountingIn':
      if (event.type === 'countInDone') {
        return { status: 'Attempting', range: state.range, tempoBpm: state.tempoBpm }
      }
      if (event.type === 'stop') {
        return { status: 'AttemptScoring', range: state.range, tempoBpm: state.tempoBpm, aborted: true }
      }
      return state

    case 'Attempting':
      if (event.type === 'loopEndReached') {
        return { status: 'AttemptScoring', range: state.range, tempoBpm: state.tempoBpm, aborted: false }
      }
      if (event.type === 'stop') {
        return { status: 'AttemptScoring', range: state.range, tempoBpm: state.tempoBpm, aborted: true }
      }
      return state

    case 'AttemptScoring':
      if (event.type === 'attemptScored') {
        return {
          status: 'AttemptComplete',
          range: state.range,
          tempoBpm: state.tempoBpm,
          aborted: state.aborted,
          aggregate: event.aggregate,
        }
      }
      return state

    case 'AttemptComplete':
      if (event.type === 'repeat') {
        return { status: 'CountingIn', range: state.range, tempoBpm: state.tempoBpm }
      }
      if (event.type === 'adjust') {
        return { status: 'SectionConfigured', range: state.range, tempoBpm: state.tempoBpm }
      }
      if (event.type === 'done') {
        return { status: 'PieceLoaded' }
      }
      return state
  }
}

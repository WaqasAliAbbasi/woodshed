import { describe, expect, it } from 'vitest'
import type { AttemptAggregate } from '../../lib/scoring/types'
import { initialPracticeState, practiceReducer, type PracticeState } from './practiceMachine'

const range = { startMeasure: 1, endMeasure: 4 }
const aggregate: AttemptAggregate = {
  expected: 4,
  correct: 4,
  missed: 0,
  extra: 0,
  onTime: 4,
  early: 0,
  late: 0,
  pitchAccuracy: 1,
  timingAccuracy: 1,
}

function runFullHappyPath(): PracticeState {
  let state = initialPracticeState
  state = practiceReducer(state, { type: 'configureSection', range, tempoBpm: 80, handFilter: 'both', mode: 'metronome' })
  state = practiceReducer(state, { type: 'start' })
  state = practiceReducer(state, { type: 'countInDone' })
  state = practiceReducer(state, { type: 'loopEndReached' })
  state = practiceReducer(state, { type: 'attemptScored', aggregate })
  return state
}

describe('practiceReducer', () => {
  it('starts in PieceLoaded', () => {
    expect(initialPracticeState.status).toBe('PieceLoaded')
  })

  it('walks the full happy path to AttemptComplete with an unaborted attempt', () => {
    const state = runFullHappyPath()
    expect(state.status).toBe('AttemptComplete')
    if (state.status === 'AttemptComplete') {
      expect(state.aborted).toBe(false)
      expect(state.aggregate).toEqual(aggregate)
      expect(state.range).toEqual(range)
      expect(state.tempoBpm).toBe(80)
    }
  })

  it('ignores events that are not valid transitions for the current state', () => {
    const state = practiceReducer(initialPracticeState, { type: 'start' })
    expect(state).toBe(initialPracticeState)
  })

  it('stopping mid count-in marks the attempt aborted', () => {
    let state = practiceReducer(initialPracticeState, {
      type: 'configureSection',
      range,
      tempoBpm: 80,
      handFilter: 'both',
      mode: 'metronome',
    })
    state = practiceReducer(state, { type: 'start' })
    state = practiceReducer(state, { type: 'stop' })
    expect(state.status).toBe('AttemptScoring')
    if (state.status === 'AttemptScoring') expect(state.aborted).toBe(true)
  })

  it('stopping mid attempt marks the attempt aborted', () => {
    let state = practiceReducer(initialPracticeState, {
      type: 'configureSection',
      range,
      tempoBpm: 80,
      handFilter: 'both',
      mode: 'metronome',
    })
    state = practiceReducer(state, { type: 'start' })
    state = practiceReducer(state, { type: 'countInDone' })
    state = practiceReducer(state, { type: 'stop' })
    expect(state.status).toBe('AttemptScoring')
    if (state.status === 'AttemptScoring') expect(state.aborted).toBe(true)
  })

  it('reaching the end of the loop naturally marks the attempt not aborted', () => {
    let state = practiceReducer(initialPracticeState, {
      type: 'configureSection',
      range,
      tempoBpm: 80,
      handFilter: 'both',
      mode: 'metronome',
    })
    state = practiceReducer(state, { type: 'start' })
    state = practiceReducer(state, { type: 'countInDone' })
    state = practiceReducer(state, { type: 'loopEndReached' })
    expect(state.status).toBe('AttemptScoring')
    if (state.status === 'AttemptScoring') expect(state.aborted).toBe(false)
  })

  it('"repeat" from AttemptComplete goes back to CountingIn, preserving range and tempo', () => {
    const complete = runFullHappyPath()
    const state = practiceReducer(complete, { type: 'repeat' })
    expect(state.status).toBe('CountingIn')
    if (state.status === 'CountingIn') {
      expect(state.range).toEqual(range)
      expect(state.tempoBpm).toBe(80)
    }
  })

  it('"adjust" from AttemptComplete goes back to SectionConfigured', () => {
    const complete = runFullHappyPath()
    const state = practiceReducer(complete, { type: 'adjust' })
    expect(state.status).toBe('SectionConfigured')
  })

  it('"done" from AttemptComplete returns to PieceLoaded', () => {
    const complete = runFullHappyPath()
    const state = practiceReducer(complete, { type: 'done' })
    expect(state).toEqual({ status: 'PieceLoaded' })
  })

  it('re-configuring the section while already configured updates range, tempo, hand filter, and mode', () => {
    let state = practiceReducer(initialPracticeState, {
      type: 'configureSection',
      range,
      tempoBpm: 80,
      handFilter: 'both',
      mode: 'metronome',
    })
    const newRange = { startMeasure: 5, endMeasure: 8 }
    state = practiceReducer(state, { type: 'configureSection', range: newRange, tempoBpm: 100, handFilter: 'right', mode: 'notes' })
    expect(state).toEqual({ status: 'SectionConfigured', range: newRange, tempoBpm: 100, handFilter: 'right', mode: 'notes' })
  })

  describe('Notes mode', () => {
    it('"start" skips CountingIn and goes straight to Attempting (no tempo to count in to)', () => {
      let state = practiceReducer(initialPracticeState, {
        type: 'configureSection',
        range,
        tempoBpm: 80,
        handFilter: 'both',
        mode: 'notes',
      })
      state = practiceReducer(state, { type: 'start' })
      expect(state.status).toBe('Attempting')
      if (state.status === 'Attempting') expect(state.mode).toBe('notes')
    })

    it('"repeat" from AttemptComplete also skips CountingIn, going straight to Attempting', () => {
      let state = practiceReducer(initialPracticeState, {
        type: 'configureSection',
        range,
        tempoBpm: 80,
        handFilter: 'both',
        mode: 'notes',
      })
      state = practiceReducer(state, { type: 'start' })
      state = practiceReducer(state, { type: 'loopEndReached' })
      state = practiceReducer(state, { type: 'attemptScored', aggregate })
      expect(state.status).toBe('AttemptComplete')
      state = practiceReducer(state, { type: 'repeat' })
      expect(state.status).toBe('Attempting')
    })

    it('stopping mid-attempt in Notes mode still marks the attempt aborted', () => {
      let state = practiceReducer(initialPracticeState, {
        type: 'configureSection',
        range,
        tempoBpm: 80,
        handFilter: 'both',
        mode: 'notes',
      })
      state = practiceReducer(state, { type: 'start' })
      state = practiceReducer(state, { type: 'stop' })
      expect(state.status).toBe('AttemptScoring')
      if (state.status === 'AttemptScoring') expect(state.aborted).toBe(true)
    })
  })
})

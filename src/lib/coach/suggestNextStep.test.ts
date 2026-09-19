import { describe, expect, it } from 'vitest'
import type { AttemptAggregate } from '../scoring/types'
import { classifyAccuracy, isReadyToStopLooping } from './suggestNextStep'

function aggregate(pitchAccuracy: number, timingAccuracy: number): AttemptAggregate {
  return {
    expected: 10,
    correct: Math.round(pitchAccuracy * 10),
    missed: 0,
    extra: 0,
    onTime: Math.round(timingAccuracy * 10),
    early: 0,
    late: 0,
    pitchAccuracy,
    timingAccuracy,
  }
}

describe('classifyAccuracy', () => {
  it('is struggling below either threshold', () => {
    expect(classifyAccuracy(0.79, 0.9)).toBe('struggling')
    expect(classifyAccuracy(0.9, 0.69)).toBe('struggling')
  })

  it('is ready at/above both thresholds', () => {
    expect(classifyAccuracy(0.95, 0.85)).toBe('ready')
  })

  it('is progressing in the middle band', () => {
    expect(classifyAccuracy(0.88, 0.85)).toBe('progressing')
  })
})

describe('isReadyToStopLooping', () => {
  it('metronome mode: matches classifyAccuracy\'s "ready" band', () => {
    expect(isReadyToStopLooping('metronome', aggregate(0.98, 0.9))).toBe(true)
    expect(isReadyToStopLooping('metronome', aggregate(0.5, 0.9))).toBe(false)
  })

  it('notes mode: ready when the pass was completely clean (zero wrong notes), even if pitchAccuracy is a trivial 100%', () => {
    // Every SequenceMatcher completion has pitchAccuracy 1.0 by construction
    // (you must play the right note to advance) — extra is the only signal
    // that actually distinguishes a clean pass from a fumbling one.
    const clean = { ...aggregate(1, 1), extra: 0 }
    expect(isReadyToStopLooping('notes', clean)).toBe(true)
  })

  it('notes mode: not ready if any wrong notes were played, even with perfect pitchAccuracy', () => {
    const messy = { ...aggregate(1, 1), extra: 3 }
    expect(isReadyToStopLooping('notes', messy)).toBe(false)
  })
})

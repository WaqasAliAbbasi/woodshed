import { describe, expect, it } from 'vitest'
import type { Attempt } from '../db/db'
import type { NoteClassification, StoredNoteResult } from '../scoring/types'
import { computeMeasureDifficulty, findWorstWindow } from './measureDifficulty'

function result(measureNumber: number, classification: NoteClassification): StoredNoteResult {
  return { classification, measureNumber, expectedMidi: 60 }
}

function attempt(noteResults: StoredNoteResult[]): Attempt {
  return {
    id: 'a1',
    sectionId: 's1',
    pieceId: 'p1',
    tempoBpm: 80,
    timestamp: 0,
    aborted: false,
    aggregate: { expected: 0, correct: 0, missed: 0, extra: 0, onTime: 0, early: 0, late: 0, pitchAccuracy: 0, timingAccuracy: 0 },
    noteResults,
  }
}

describe('computeMeasureDifficulty', () => {
  it('excludes measures with too few samples to be meaningful', () => {
    const attempts = [attempt([result(1, 'missed'), result(1, 'missed')])] // only 2 results
    expect(computeMeasureDifficulty(attempts)).toEqual([])
  })

  it('classifies a measure missed every time as struggling once there is enough sample size', () => {
    const attempts = [attempt([result(1, 'missed'), result(1, 'missed'), result(1, 'missed')])]
    expect(computeMeasureDifficulty(attempts)).toEqual([{ measureNumber: 1, status: 'struggling', sampleSize: 3 }])
  })

  it('classifies a measure gotten right every time as ready', () => {
    const attempts = [attempt([result(1, 'onTime'), result(1, 'onTime'), result(1, 'onTime')])]
    expect(computeMeasureDifficulty(attempts)).toEqual([{ measureNumber: 1, status: 'ready', sampleSize: 3 }])
  })

  it('rolls results up across multiple attempts, not just the most recent', () => {
    const attempts = [attempt([result(1, 'missed'), result(1, 'missed')]), attempt([result(1, 'onTime')])]
    const [difficulty] = computeMeasureDifficulty(attempts)
    expect(difficulty).toMatchObject({ measureNumber: 1, sampleSize: 3 })
  })

  it('ignores results with no measureNumber', () => {
    const attempts = [attempt([{ classification: 'extra' }, { classification: 'extra' }, { classification: 'extra' }])]
    expect(computeMeasureDifficulty(attempts)).toEqual([])
  })

  it('treats early/late the same as onTime — this is about pitch, not rhythm', () => {
    const attempts = [attempt([result(1, 'early'), result(1, 'late'), result(1, 'onTime')])]
    expect(computeMeasureDifficulty(attempts)).toEqual([{ measureNumber: 1, status: 'ready', sampleSize: 3 }])
  })
})

describe('findWorstWindow', () => {
  it('picks the contiguous window with the worst combined status', () => {
    const difficulty = [
      { measureNumber: 1, status: 'ready' as const, sampleSize: 5 },
      { measureNumber: 2, status: 'ready' as const, sampleSize: 5 },
      { measureNumber: 3, status: 'struggling' as const, sampleSize: 5 },
      { measureNumber: 4, status: 'struggling' as const, sampleSize: 5 },
      { measureNumber: 5, status: 'ready' as const, sampleSize: 5 },
    ]
    expect(findWorstWindow(difficulty, 2, 1, 5)).toEqual({ startMeasure: 3, endMeasure: 4 })
  })

  it('skips windows with no data at all rather than recommending them by default', () => {
    const difficulty = [{ measureNumber: 8, status: 'struggling' as const, sampleSize: 5 }]
    // measures 1-2 have zero data; 8 is the only real signal, but the window must contain it
    expect(findWorstWindow(difficulty, 2, 1, 10)).toEqual({ startMeasure: 7, endMeasure: 8 })
  })

  it('returns undefined when there is no data anywhere in range', () => {
    expect(findWorstWindow([], 2, 1, 10)).toBeUndefined()
  })

  it('keeps the earliest window on a tie', () => {
    const difficulty = [
      { measureNumber: 1, status: 'struggling' as const, sampleSize: 5 },
      { measureNumber: 2, status: 'struggling' as const, sampleSize: 5 },
      { measureNumber: 3, status: 'struggling' as const, sampleSize: 5 },
      { measureNumber: 4, status: 'struggling' as const, sampleSize: 5 },
    ]
    expect(findWorstWindow(difficulty, 2, 1, 4)).toEqual({ startMeasure: 1, endMeasure: 2 })
  })
})

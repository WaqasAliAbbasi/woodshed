import { describe, expect, it } from 'vitest'
import { aggregate } from './aggregate'
import type { NoteResult } from './types'

function correct(hand: 'left' | 'right', velocity: number): NoteResult {
  return { classification: 'onTime', hand, velocity, expectedMidi: 60, expectedOnsetSec: 0 }
}

describe('aggregate accuracy', () => {
  it('does not read as 100% timing when only a few of many expected notes were played', () => {
    // 20 expected, only 3 played, all on time — this used to score
    // timingAccuracy at 100% (onTime / correct) despite being a mostly-missed
    // attempt. It should read as mostly-missed on timing too.
    const results: NoteResult[] = [correct('right', 80), correct('right', 80), correct('right', 80)]
    const { pitchAccuracy, timingAccuracy, timingAccuracyOfCorrect } = aggregate(results, 20)
    expect(pitchAccuracy).toBeCloseTo(0.15)
    expect(timingAccuracy).toBeCloseTo(0.15)
    expect(timingAccuracyOfCorrect).toBe(1)
  })

  it('timingAccuracyOfCorrect isolates rhythm quality from how many notes were attempted', () => {
    const results: NoteResult[] = [
      correct('right', 80),
      correct('right', 80),
      { classification: 'late', hand: 'right', velocity: 80, expectedMidi: 60, expectedOnsetSec: 0, deltaMs: 200 },
    ]
    const { timingAccuracy, timingAccuracyOfCorrect } = aggregate(results, 3)
    expect(timingAccuracy).toBeCloseTo(2 / 3)
    expect(timingAccuracyOfCorrect).toBeCloseTo(2 / 3)
  })
})

describe('aggregate handBalance', () => {
  it('averages velocity per hand across correctly-matched notes', () => {
    const results: NoteResult[] = [correct('left', 40), correct('left', 60), correct('right', 90), correct('right', 100)]
    const { handBalance } = aggregate(results, 4)
    expect(handBalance).toMatchObject({ leftAvgVelocity: 50, rightAvgVelocity: 95, leftNoteCount: 2, rightNoteCount: 2 })
  })

  it('is undefined when only one hand played anything (hands-separate practice)', () => {
    const results: NoteResult[] = [correct('right', 80), correct('right', 90)]
    const { handBalance } = aggregate(results, 2)
    expect(handBalance).toBeUndefined()
  })

  it('is undefined when there are no matched notes at all', () => {
    const results: NoteResult[] = [{ classification: 'missed', expectedMidi: 60, expectedOnsetSec: 0, hand: 'left' }]
    const { handBalance } = aggregate(results, 1)
    expect(handBalance).toBeUndefined()
  })

  it('ignores extra (wrong) notes and missed notes, even though they carry velocity or hand', () => {
    const results: NoteResult[] = [
      correct('left', 40),
      correct('right', 80),
      { classification: 'extra', velocity: 127 }, // no hand — must not skew either side
      { classification: 'missed', hand: 'left', expectedMidi: 62, expectedOnsetSec: 1 }, // no velocity
    ]
    const { handBalance } = aggregate(results, 3)
    expect(handBalance).toMatchObject({ leftAvgVelocity: 40, rightAvgVelocity: 80, leftNoteCount: 1, rightNoteCount: 1 })
  })

  it('does not count a note played early/late any differently from onTime for balance purposes', () => {
    const results: NoteResult[] = [
      { classification: 'early', hand: 'left', velocity: 50, expectedMidi: 60, expectedOnsetSec: 0 },
      { classification: 'late', hand: 'right', velocity: 70, expectedMidi: 64, expectedOnsetSec: 0 },
    ]
    const { handBalance } = aggregate(results, 2)
    expect(handBalance).toMatchObject({ leftAvgVelocity: 50, rightAvgVelocity: 70 })
  })
})

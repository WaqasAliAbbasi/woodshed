import { describe, expect, it } from 'vitest'
import { aggregate, attempt, chunk, MIN, MISS, notes, NOW, READY, section } from './__fixtures__/attempts'
import { piecePath } from './nextStep'
import { firstHalf, settingsFor, weakerHand, type StepContext } from './stepSettings'
import type { PathAttempt } from './types'

const t = (minutesAgo: number) => NOW - minutesAgo * MIN
const chunks = [chunk(0, 7, 9), chunk(1, 10, 12)]
const sections = [
  section('n', 'c0', 'notes', [7, 9]),
  section('m', 'c0', 'metronome', [7, 9]),
  section('t', 'c0', 'tempo', [7, 9]),
]

function context(attempts: PathAttempt[], target = 69): StepContext {
  return {
    path: piecePath({ chunks, sections, attempts, targetTempoBpm: target, now: NOW }),
    attempts,
    rung3Passes: [],
    targetTempoBpm: target,
    now: NOW,
    sectionRung: new Map(sections.map((s) => [s.id, { chunkId: s.chunkId, rung: s.rung }])),
  }
}

describe('settingsFor', () => {
  it('walks a chunk Notes → Metronome → Build tempo → Ready with the tempo rules', () => {
    let attempts: PathAttempt[] = []
    let ctx = context(attempts)
    expect(ctx.path.next).toMatchObject({ kind: 'chunk', rung: 'notes' })
    expect(settingsFor({ kind: 'chunk', idx: 0, rung: 'notes' }, ctx)).toMatchObject({ mode: 'notes', label: 'Chunk 1 · Notes' })

    attempts = [attempt('n', t(60), notes(1))]
    ctx = context(attempts)
    expect(ctx.path.next).toMatchObject({ rung: 'metronome' })
    const rung3 = settingsFor({ kind: 'chunk', idx: 0, rung: 'metronome' }, ctx)
    // No recent pass anywhere: 70% of 69, on the dial.
    expect(rung3.tempo.bpm).toBe(48)
    expect(rung3.mode).toBe('metronome')

    attempts.push(attempt('m', t(50), READY, { tempoBpm: 48 }), attempt('m', t(49), READY, { tempoBpm: 48 }))
    ctx = context(attempts)
    expect(ctx.path.next).toMatchObject({ rung: 'tempo' })
    const sequence: number[] = []
    const results = [READY, READY, MISS, READY, READY, READY]
    for (const [i, result] of results.entries()) {
      const bpm = settingsFor({ kind: 'chunk', idx: 0, rung: 'tempo' }, context(attempts)).tempo.bpm
      sequence.push(bpm)
      attempts.push(attempt('t', t(40 - i), result, { tempoBpm: bpm }))
    }
    // 52✓ 58✓ 63✗ → one dial step under the last pass (58) → 56✓ 63✓ 69✓
    expect(sequence).toEqual([52, 58, 63, 56, 63, 69])
    expect(context(attempts).path.chunks[0].progress.ready).toBe(false)
    attempts.push(attempt('t', t(30), READY, { tempoBpm: 69 }))
    expect(context(attempts).path.chunks[0].progress.ready).toBe(true)
  })

  it('stays at the last passed tempo and ends the day when Build tempo is stuck', () => {
    const attempts = [
      attempt('n', t(60), notes(0)),
      attempt('m', t(50), READY, { tempoBpm: 60 }),
      attempt('m', t(49), READY, { tempoBpm: 60 }),
      attempt('t', t(40), READY, { tempoBpm: 66 }),
      attempt('t', t(30), MISS, { tempoBpm: 69 }),
      attempt('t', t(20), MISS, { tempoBpm: 63 }),
      attempt('t', t(10), MISS, { tempoBpm: 63 }),
    ]
    const s = settingsFor({ kind: 'chunk', idx: 0, rung: 'tempo' }, context(attempts))
    expect(s.tempo.bpm).toBe(66)
    expect(s.endToday).toBe(true)
  })

  it('takes a Slower offer for one try', () => {
    const attempts = [attempt('n', t(60), notes(0))]
    expect(settingsFor({ kind: 'chunk', idx: 0, rung: 'metronome', slowerBpm: 44 }, context(attempts)).tempo).toEqual({
      bpm: 44,
      reason: 'A little slower, this try',
    })
  })

  it('plays the whole piece as a run-through at the target', () => {
    const s = settingsFor({ kind: 'join', k: 2 }, context([]))
    expect(s).toMatchObject({ runThrough: true, label: 'Whole piece', range: { startMeasure: 7, endMeasure: 12 }, tempo: { bpm: 69 } })
  })

  it('drills the seam: last bar of one chunk, first bar of the next', () => {
    expect(settingsFor({ kind: 'seam', k: 2 }, context([])).range).toEqual({ startMeasure: 9, endMeasure: 10 })
  })
})

describe('weakerHand / firstHalf', () => {
  it('guesses the weaker hand from where wrong notes landed', () => {
    const wrongLow: PathAttempt = {
      ...attempt('n', t(1), aggregate({ extra: 3 })),
      noteResults: [
        { classification: 'extra', actualMidi: 48 },
        { classification: 'extra', actualMidi: 50 },
        { classification: 'extra', actualMidi: 72 },
      ],
    }
    expect(weakerHand([wrongLow])).toBe('left')
    expect(weakerHand([])).toBe('right')
  })

  it('halves a range, keeping at least one bar', () => {
    expect(firstHalf({ startMeasure: 7, endMeasure: 9 })).toEqual({ startMeasure: 7, endMeasure: 7 })
    expect(firstHalf({ startMeasure: 0, endMeasure: 4 })).toEqual({ startMeasure: 0, endMeasure: 1 })
    expect(firstHalf({ startMeasure: 1, endMeasure: 4 })).toEqual({ startMeasure: 1, endMeasure: 2 })
  })
})

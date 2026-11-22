import { describe, expect, it } from 'vitest'
import { aggregate, attempt, chunk, MIN, notes, NOW, READY, section } from './__fixtures__/attempts'
import { buildDailyPlan } from './buildDailyPlan'
import { deriveState, lastLessonDate, nextLessonDate, shortDate, type DeriveInput } from './deriveState'

const DAY = 24 * 60 * MIN

function input(overrides: Partial<DeriveInput> = {}): DeriveInput {
  return {
    pieces: [
      { id: 'p1', title: 'Divertimento', targetTempoBpm: 69 },
      { id: 'p2', title: 'Berry', finishedAt: NOW - DAY },
    ],
    chunks: [chunk(0, 1, 4), chunk(1, 5, 8)],
    sections: [section('n', 'c0', 'notes', [1, 4]), section('m', 'c0', 'metronome', [1, 4])],
    attempts: [
      attempt('n', NOW - 30 * MIN, notes(0)),
      attempt('m', NOW - 20 * MIN, READY, { tempoBpm: 48 }),
      attempt('m', NOW - 10 * MIN, aggregate({ timingAccuracyOfCorrect: 0.6 }), { tempoBpm: 48 }),
    ],
    lessons: [
      { startedAt: NOW - DAY, pieces: [{ pieceId: 'p1', outcome: 'continue', focus: 'm. 3' }, { pieceId: 'p2', outcome: 'finished' }] },
    ],
    collections: [{ kind: 'exam', pieces: [{ pieceId: 'p2' }] }],
    ...overrides,
  }
}

describe('deriveState', () => {
  it('builds a path per chunked piece and the plan input from the latest lessons', () => {
    const state = deriveState(input(), NOW)
    expect([...state.paths.keys()]).toEqual(['p1'])
    expect(state.targets.get('p2')).toBe(80)
    const [div, berry] = state.plan.pieces
    expect(div).toMatchObject({ lesson: { outcome: 'continue', focus: 'm. 3', fromLatestLesson: true }, recentRhythm: 0.6, targetTempoBpm: 69 })
    expect(berry).toMatchObject({ finished: true, inExam: true, path: undefined })
    expect(buildDailyPlan(state.plan, NOW + DAY).activePieceIds).toEqual(['p1'])
  })

  it('collects rung-3 passes across the library for the start tempo', () => {
    const attempts = [attempt('n', NOW - 30 * MIN, notes(0)), attempt('m', NOW - 20 * MIN, READY, { tempoBpm: 52 }), attempt('m', NOW - 10 * MIN, READY, { tempoBpm: 52 })]
    expect(deriveState(input({ attempts }), NOW).rung3Passes).toEqual([{ tempoBpm: 52, passedAt: NOW - 10 * MIN }])
  })

  it('reads a piece’s outcome from the latest lesson that covered it', () => {
    const lessons = [
      { startedAt: NOW, pieces: [{ pieceId: 'p2', outcome: 'continue' as const }] },
      { startedAt: NOW - DAY, pieces: [{ pieceId: 'p1', outcome: 'new' as const, focus: 'stale' }] },
    ]
    const [div] = deriveState(input({ lessons }), NOW).plan.pieces
    expect(div.lesson).toMatchObject({ outcome: 'new', fromLatestLesson: false })
  })
})

describe('lesson dates', () => {
  // NOW is Sunday 22 Nov 2026.
  it('finds the next and the last lesson day', () => {
    expect(shortDate(nextLessonDate(NOW, 6)!)).toBe('Sat 28 Nov')
    expect(shortDate(nextLessonDate(NOW, 0)!)).toBe('Sun 22 Nov')
    expect(shortDate(lastLessonDate(NOW, 6))).toBe('Sat 21 Nov')
    expect(nextLessonDate(NOW, undefined)).toBeUndefined()
  })
})

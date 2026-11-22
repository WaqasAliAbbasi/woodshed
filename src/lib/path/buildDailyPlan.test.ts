import { describe, expect, it } from 'vitest'
import { attempt, chunk, MIN, notes, NOW, READY, section } from './__fixtures__/attempts'
import { buildDailyPlan, type PlanPieceInput } from './buildDailyPlan'
import { piecePath } from './nextStep'

const DAY = 24 * 60 * MIN
const YESTERDAY = NOW - DAY

/** A 3-chunk path with chunk 1 ready (at `readyAt`) and chunk 2 at Notes. */
function pathWithChunkOneReady(readyAt: number) {
  const chunks = [chunk(0, 1, 4), chunk(1, 5, 8), chunk(2, 9, 12)]
  const sections = [section('n', 'c0', 'notes', [1, 4]), section('m', 'c0', 'metronome', [1, 4])]
  const attempts = [
    attempt('n', readyAt - 3 * MIN, notes(0)),
    attempt('m', readyAt - 2 * MIN, READY),
    attempt('m', readyAt - MIN, READY),
  ]
  return piecePath({ chunks, sections, attempts, targetTempoBpm: 80, now: NOW })
}

const freshPath = () => piecePath({ chunks: [chunk(0, 1, 4), chunk(1, 5, 8)], sections: [], attempts: [], targetTempoBpm: 80, now: NOW })

function piece(id: string, overrides: Partial<PlanPieceInput> = {}): PlanPieceInput {
  return { pieceId: id, title: id, finished: false, inExam: false, targetTempoBpm: 80, path: freshPath(), ...overrides }
}

describe('buildDailyPlan', () => {
  it('plans across the remaining pieces after a Finished / Keep going + focus / New lesson, ending on a win', () => {
    const lessonAt = YESTERDAY
    const plan = buildDailyPlan(
      {
        pieces: [
          piece('Berry', { finished: true, inExam: true, lesson: { outcome: 'finished', at: lessonAt, fromLatestLesson: true } }),
          piece('Divertimento', {
            path: pathWithChunkOneReady(NOW - 2 * DAY),
            lesson: { outcome: 'continue', at: lessonAt, focus: 'Chunk 2 hands together', fromLatestLesson: true },
          }),
          piece('Lullaby', { lesson: { outcome: 'new', at: lessonAt, fromLatestLesson: true } }),
        ],
      },
      NOW,
      20,
    )

    expect(plan.activePieceIds).toEqual(['Divertimento', 'Lullaby'])
    expect(plan.steps.map((s) => [s.kind, s.pieceId])).toEqual([
      ['warmup', 'Divertimento'],
      ['block', 'Divertimento'],
      ['block', 'Lullaby'],
      ['block', 'Divertimento'],
      ['win', 'Divertimento'],
    ])
    expect(plan.steps[1].why).toBe("Your teacher's focus: Chunk 2 hands together")
    expect(plan.steps[1].what).toBe('chunk 2 · notes')
    expect(plan.steps[2].why).toBe('New from the lesson')
    expect(plan.steps.at(-1)).toMatchObject({ kind: 'win', what: 'Divertimento · chunk 1', target: { kind: 'review', item: { kind: 'chunk', idx: 0 } } })
    expect(plan.minutes).toBeLessThanOrEqual(20)
    expect(plan.focus).toEqual([{ pieceId: 'Divertimento', title: 'Divertimento', focus: 'Chunk 2 hands together' }])
  })

  it('adds a New piece only from the day after the lesson', () => {
    const plan = buildDailyPlan({ pieces: [piece('Lullaby', { lesson: { outcome: 'new', at: NOW - 60 * MIN, fromLatestLesson: true } })] }, NOW)
    expect(plan.steps).toEqual([])
  })

  it('gives each piece at most 2 blocks and keeps 2 minutes for the win', () => {
    const lesson = { outcome: 'continue' as const, at: YESTERDAY, fromLatestLesson: true }
    const plan = buildDailyPlan({ pieces: [piece('A', { lesson, path: pathWithChunkOneReady(YESTERDAY) })] }, NOW, 30)
    expect(plan.steps.filter((s) => s.kind === 'block')).toHaveLength(2)
    expect(plan.steps.at(-1)?.kind).toBe('win')
  })

  it('fits the 10-minute budget: warm-up, one block, a 1-minute win', () => {
    const lesson = { outcome: 'continue' as const, at: YESTERDAY, fromLatestLesson: true }
    const plan = buildDailyPlan(
      { pieces: [piece('A', { lesson, path: pathWithChunkOneReady(YESTERDAY) }), piece('B', { lesson })] },
      NOW,
      10,
    )
    expect(plan.steps.map((s) => [s.kind, s.minutes])).toEqual([
      ['warmup', 2],
      ['block', 5],
      ['win', 1],
    ])
  })

  it('gives a ready exam piece one short review a week', () => {
    const exam = piece('Berry', { finished: true, inExam: true, lastPathAttemptAt: NOW - 8 * DAY })
    const lesson = { outcome: 'continue' as const, at: YESTERDAY, fromLatestLesson: true }
    const a = piece('A', { lesson, path: pathWithChunkOneReady(YESTERDAY) })
    let plan = buildDailyPlan({ pieces: [a, exam] }, NOW, 20)
    expect(plan.steps.find((s) => s.kind === 'review')).toMatchObject({ pieceId: 'Berry', why: 'Exam piece · weekly review' })

    plan = buildDailyPlan({ pieces: [a, { ...exam, lastPathAttemptAt: NOW - 2 * DAY }] }, NOW, 20)
    expect(plan.steps.find((s) => s.kind === 'review')).toBeUndefined()
  })

  it('names an exam piece’s rhythm problem in its reason', () => {
    const lesson = { outcome: 'continue' as const, at: YESTERDAY, fromLatestLesson: true }
    const plan = buildDailyPlan({ pieces: [piece('Remember Me', { lesson, inExam: true, recentRhythm: 0.62 })] }, NOW)
    expect(plan.steps[0].why).toBe('Exam piece · rhythm was 62%')
  })

  it('ignores a focus from an older lesson', () => {
    const lesson = { outcome: 'continue' as const, at: YESTERDAY - DAY * 7, focus: 'old', fromLatestLesson: false }
    const plan = buildDailyPlan({ pieces: [piece('A', { lesson })] }, NOW)
    expect(plan.focus).toEqual([])
    expect(plan.steps[0].why).toBe('Keep going, from the lesson')
  })

  it('falls back to a finished piece for the win when nothing active is ready yet', () => {
    const lesson = { outcome: 'continue' as const, at: YESTERDAY, fromLatestLesson: true }
    const plan = buildDailyPlan(
      { pieces: [piece('A', { lesson }), piece('Berry', { finished: true, lastPathAttemptAt: NOW - DAY })] },
      NOW,
    )
    expect(plan.steps.at(-1)).toMatchObject({ kind: 'win', pieceId: 'Berry', target: { item: 'whole' } })
  })

  it("doesn't review the piece the plan already ends on", () => {
    const lesson = { outcome: 'continue' as const, at: YESTERDAY, fromLatestLesson: true }
    const berry = piece('Berry', { finished: true, inExam: true, lastPathAttemptAt: NOW - 8 * DAY })
    const plan = buildDailyPlan({ pieces: [piece('A', { lesson }), berry] }, NOW, 20)
    expect(plan.steps.map((s) => s.kind)).toEqual(['block', 'block', 'win'])
  })
})

import { describe, expect, it } from 'vitest'
import type { Attempt } from '../db/db'
import { summarizeSession } from './session'

function attempt(timestamp: number, durationMs = 0): Attempt {
  return {
    id: `a-${timestamp}`,
    sectionId: 's1',
    pieceId: 'p1',
    tempoBpm: 80,
    timestamp,
    aborted: false,
    durationMs,
    noteResults: [],
    aggregate: { expected: 0, correct: 0, missed: 0, extra: 0, onTime: 0, early: 0, late: 0, pitchAccuracy: 0, timingAccuracy: 0 },
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
const NOON = Date.UTC(2026, 0, 15, 12, 0, 0)

describe('summarizeSession', () => {
  it('sums durationMs and counts attempts from today only', () => {
    const attempts = [attempt(NOON - 60_000, 60_000), attempt(NOON - 30_000, 90_000)]
    const summary = summarizeSession(attempts, NOON)
    expect(summary.todayDurationMs).toBe(150_000)
    expect(summary.todayAttemptCount).toBe(2)
    expect(summary.lastPracticedBeforeToday).toBeUndefined()
  })

  it('excludes attempts from a prior calendar day from today\'s totals', () => {
    const attempts = [attempt(NOON - DAY_MS, 60_000)]
    const summary = summarizeSession(attempts, NOON)
    expect(summary.todayDurationMs).toBe(0)
    expect(summary.todayAttemptCount).toBe(0)
  })

  it('reports the most recent attempt from before today', () => {
    const threeDaysAgo = NOON - 3 * DAY_MS
    const twoDaysAgo = NOON - 2 * DAY_MS
    const attempts = [attempt(threeDaysAgo), attempt(twoDaysAgo)]
    const summary = summarizeSession(attempts, NOON)
    expect(summary.lastPracticedBeforeToday).toBe(twoDaysAgo)
  })

  it('is undefined for lastPracticedBeforeToday when there is no history at all', () => {
    expect(summarizeSession([], NOON).lastPracticedBeforeToday).toBeUndefined()
  })

  it('attempts recorded before duration tracking existed contribute 0, not NaN', () => {
    const attemptWithoutDuration = attempt(NOON)
    delete (attemptWithoutDuration as { durationMs?: number }).durationMs
    const summary = summarizeSession([attemptWithoutDuration], NOON)
    expect(summary.todayDurationMs).toBe(0)
  })
})

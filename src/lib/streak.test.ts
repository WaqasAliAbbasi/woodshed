import { describe, expect, it } from 'vitest'
import { computeStreak } from './streak'

/** A fixed "now", well clear of any DST transition, plus a helper to build timestamps N days before it at a given local hour. */
const NOW = new Date(2026, 5, 15, 20, 0, 0).getTime() // 2026-06-15 20:00 local

function daysAgoAt(daysAgo: number, hour: number): number {
  const base = new Date(NOW)
  base.setDate(base.getDate() - daysAgo)
  base.setHours(hour, 0, 0, 0)
  return base.getTime()
}

describe('computeStreak', () => {
  it('is all zero with no attempts', () => {
    expect(computeStreak([], NOW)).toEqual({ current: 0, longest: 0, lastPracticedDay: undefined })
  })

  it('counts a single attempt today as a streak of 1', () => {
    const result = computeStreak([{ timestamp: daysAgoAt(0, 12) }], NOW)
    expect(result.current).toBe(1)
    expect(result.longest).toBe(1)
  })

  it('keeps the streak alive if the last practice was yesterday, not yet today', () => {
    const result = computeStreak([{ timestamp: daysAgoAt(1, 12) }], NOW)
    expect(result.current).toBe(1)
  })

  it('breaks the streak once a full day is skipped', () => {
    const result = computeStreak([{ timestamp: daysAgoAt(2, 12) }], NOW)
    expect(result.current).toBe(0)
  })

  it('counts consecutive days correctly, and multiple attempts on one day only once', () => {
    const attempts = [
      { timestamp: daysAgoAt(0, 9) },
      { timestamp: daysAgoAt(0, 21) },
      { timestamp: daysAgoAt(1, 12) },
      { timestamp: daysAgoAt(2, 12) },
    ]
    const result = computeStreak(attempts, NOW)
    expect(result.current).toBe(3)
    expect(result.longest).toBe(3)
  })

  it('finds the longest streak even when it is not the current one', () => {
    const attempts = [
      // A 4-day run, ending 10 days ago (streak broken since).
      { timestamp: daysAgoAt(10, 12) },
      { timestamp: daysAgoAt(11, 12) },
      { timestamp: daysAgoAt(12, 12) },
      { timestamp: daysAgoAt(13, 12) },
      // A single day, today.
      { timestamp: daysAgoAt(0, 12) },
    ]
    const result = computeStreak(attempts, NOW)
    expect(result.current).toBe(1)
    expect(result.longest).toBe(4)
  })

  it('credits a session just after midnight to the previous day, per the 4am day boundary', () => {
    // 1:30am "today" is still yesterday's practice day.
    const lateNight = new Date(NOW)
    lateNight.setHours(1, 30, 0, 0)
    const yesterdayEvening = daysAgoAt(1, 20)

    const result = computeStreak([{ timestamp: lateNight.getTime() }, { timestamp: yesterdayEvening }], NOW)
    // Both attempts land on the same practice day, so this is a streak of 1
    // reaching back to "yesterday" (today hasn't been practiced past 4am yet).
    expect(result.current).toBe(1)
    expect(result.longest).toBe(1)
  })

  it('handles an unsorted, duplicate-heavy attempt list the same as a clean one', () => {
    const attempts = [
      { timestamp: daysAgoAt(1, 8) },
      { timestamp: daysAgoAt(0, 22) },
      { timestamp: daysAgoAt(1, 9) },
      { timestamp: daysAgoAt(0, 8) },
    ]
    expect(computeStreak(attempts, NOW).current).toBe(2)
  })
})

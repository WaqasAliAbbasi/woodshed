import { describe, expect, it } from 'vitest'
import type { PracticeSession } from '../../lib/db/db'
import { practiceDayKey } from '../../lib/streak'
import { buildDailyMinutesMap, buildHeatmapDays, dailyBuckets, weeklyBuckets } from './dailyMinutes'

function session(startedAt: number, durationMinutes: number): PracticeSession {
  return {
    id: `s-${startedAt}`,
    startedAt,
    endedAt: startedAt + durationMinutes * 60_000,
    source: 'derived',
    createdAt: startedAt,
    updatedAt: startedAt,
    attemptCount: 1,
    scoredMs: durationMinutes * 60_000,
    pieceIds: [],
  }
}

const NOW = new Date(2026, 5, 15, 20, 0, 0).getTime() // 2026-06-15 20:00 local
function at(hour: number, dayOffset = 0): number {
  const d = new Date(NOW)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}

describe('buildDailyMinutesMap', () => {
  it('sums minutes for sessions on the same practice day', () => {
    const map = buildDailyMinutesMap([session(at(10), 20), session(at(15), 10)])
    expect(map.get(practiceDayKey(at(10)))).toBe(30)
  })

  it('keeps different practice days separate', () => {
    const map = buildDailyMinutesMap([session(at(10), 20), session(at(10, -1), 15)])
    expect(map.get(practiceDayKey(at(10)))).toBe(20)
    expect(map.get(practiceDayKey(at(10, -1)))).toBe(15)
  })

  it('returns an empty map for no sessions', () => {
    expect(buildDailyMinutesMap([]).size).toBe(0)
  })
})

describe('buildHeatmapDays', () => {
  it('returns exactly `days` entries, oldest first, ending today', () => {
    const map = buildDailyMinutesMap([session(at(10), 20)])
    const days = buildHeatmapDays(map, 5, NOW)
    expect(days).toHaveLength(5)
    expect(days.at(-1)?.dayKey).toBe(practiceDayKey(NOW))
    expect(days.at(-1)?.minutes).toBe(20)
  })

  it('fills gaps with 0 minutes', () => {
    const days = buildHeatmapDays(new Map(), 3, NOW)
    expect(days.every((d) => d.minutes === 0)).toBe(true)
  })
})

describe('dailyBuckets', () => {
  it('produces one labeled bucket per day', () => {
    const map = buildDailyMinutesMap([session(at(10), 45)])
    const buckets = dailyBuckets(map, 2, NOW)
    expect(buckets).toHaveLength(2)
    expect(buckets.at(-1)?.minutes).toBe(45)
    expect(buckets.at(-1)?.label).toBeTruthy()
  })
})

describe('weeklyBuckets', () => {
  it('sums each 7-day week into one bucket', () => {
    const map = buildDailyMinutesMap([session(at(10), 30), session(at(10, -1), 30), session(at(10, -10), 60)])
    const buckets = weeklyBuckets(map, 2, NOW)
    expect(buckets).toHaveLength(2)
    // The most recent week (days -6..0) should hold the two 30-min sessions.
    expect(buckets.at(-1)?.minutes).toBe(60)
    // The earlier week (days -13..-7) should hold the 60-min session at -10.
    expect(buckets.at(0)?.minutes).toBe(60)
  })
})

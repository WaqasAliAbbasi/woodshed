import { describe, expect, it } from 'vitest'
import type { Attempt } from './db/db'
import { buildPieceStatsMap, formatDuration, formatPracticeDate, sortPiecesByRecency } from './pieceStats'

function attempt(pieceId: string, timestamp: number, durationMs?: number): Attempt {
  return {
    id: `${pieceId}-${timestamp}`,
    sectionId: 'section-1',
    pieceId,
    tempoBpm: 80,
    timestamp,
    aborted: false,
    aggregate: { expected: 1, correct: 1, missed: 0, extra: 0, onTime: 1, early: 0, late: 0, pitchAccuracy: 1, timingAccuracy: 1 },
    durationMs,
    noteResults: [],
  }
}

describe('buildPieceStatsMap', () => {
  it('sums duration and tracks first/last practiced across multiple attempts of the same piece', () => {
    const attempts = [attempt('p1', 1000, 30_000), attempt('p1', 3000, 45_000), attempt('p1', 2000, 15_000)]
    const stats = buildPieceStatsMap(attempts).get('p1')
    expect(stats).toMatchObject({ totalDurationMs: 90_000, firstPracticedAt: 1000, lastPracticedAt: 3000 })
  })

  it('keeps different pieces separate', () => {
    const attempts = [attempt('p1', 1000, 10_000), attempt('p2', 2000, 20_000)]
    const map = buildPieceStatsMap(attempts)
    expect(map.get('p1')).toMatchObject({ totalDurationMs: 10_000 })
    expect(map.get('p2')).toMatchObject({ totalDurationMs: 20_000 })
  })

  it('treats a missing durationMs (attempts recorded before duration tracking existed) as contributing 0', () => {
    const attempts = [attempt('p1', 1000, undefined), attempt('p1', 2000, 5_000)]
    const stats = buildPieceStatsMap(attempts).get('p1')
    expect(stats?.totalDurationMs).toBe(5_000)
  })

  it('returns an empty map for no attempts', () => {
    expect(buildPieceStatsMap([]).size).toBe(0)
  })
})

describe('sortPiecesByRecency', () => {
  const pieces = [
    { id: 'a', createdAt: 100 },
    { id: 'b', createdAt: 300 },
    { id: 'c', createdAt: 200 },
  ]

  it('puts the most recently practiced piece first', () => {
    const stats = buildPieceStatsMap([attempt('a', 500), attempt('b', 900), attempt('c', 700)])
    const sorted = sortPiecesByRecency(pieces, stats)
    expect(sorted.map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('sorts never-practiced pieces after practiced ones, newest upload first', () => {
    const stats = buildPieceStatsMap([attempt('c', 500)]) // only c has been practiced
    const sorted = sortPiecesByRecency(pieces, stats)
    expect(sorted.map((p) => p.id)).toEqual(['c', 'b', 'a']) // b (createdAt 300) then a (createdAt 100)
  })

  it('does not mutate the input array', () => {
    const original = [...pieces]
    sortPiecesByRecency(pieces, buildPieceStatsMap([attempt('a', 500)]))
    expect(pieces).toEqual(original)
  })
})

describe('formatDuration', () => {
  it('shows minutes only under an hour', () => {
    expect(formatDuration(45 * 60_000)).toBe('45m')
  })

  it('shows whole hours with no minutes remainder', () => {
    expect(formatDuration(2 * 60 * 60_000)).toBe('2h')
  })

  it('shows hours and minutes', () => {
    expect(formatDuration(2 * 60 * 60_000 + 15 * 60_000)).toBe('2h 15m')
  })

  it('floors sub-minute totals to a placeholder instead of "0m"', () => {
    expect(formatDuration(20_000)).toBe('<1m')
  })
})

describe('formatPracticeDate', () => {
  it('formats a timestamp as a date only, with no time component', () => {
    const formatted = formatPracticeDate(new Date('2026-03-05T14:30:00').getTime())
    expect(formatted).not.toMatch(/\d{1,2}:\d{2}/)
    expect(formatted).toContain('2026')
  })
})

import { describe, expect, it } from 'vitest'
import type { PracticeSession } from '../../lib/db/db'
import { practiceDayKey } from '../../lib/streak'
import { formatDayHeader, groupByPracticeDay } from './groupByPracticeDay'

function session(id: string, startedAt: number, overrides: Partial<PracticeSession> = {}): PracticeSession {
  return {
    id,
    startedAt,
    endedAt: startedAt + 60_000,
    source: 'derived',
    createdAt: startedAt,
    updatedAt: startedAt,
    attemptCount: 1,
    scoredMs: 60_000,
    pieceIds: [],
    ...overrides,
  }
}

const NOW = new Date(2026, 5, 15, 20, 0, 0).getTime() // 2026-06-15 20:00 local
function at(hour: number, dayOffset = 0): number {
  const d = new Date(NOW)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}

describe('groupByPracticeDay', () => {
  it('returns no groups for no sessions', () => {
    expect(groupByPracticeDay([])).toEqual([])
  })

  it('groups same-day sessions together, preserving order', () => {
    const s1 = session('a', at(20))
    const s2 = session('b', at(9))
    const grouped = groupByPracticeDay([s1, s2])
    expect(grouped).toHaveLength(1)
    expect(grouped[0].sessions.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('keeps a late-night session (before 4am) on the previous practice day', () => {
    const lateNight = session('late', at(1)) // 1am — before the 4am boundary
    const earlier = session('earlier', at(21, -1)) // 9pm the day before
    const grouped = groupByPracticeDay([lateNight, earlier])
    expect(grouped).toHaveLength(1)
    expect(grouped[0].sessions.map((s) => s.id)).toEqual(['late', 'earlier'])
  })

  it('splits sessions on different practice days into separate groups, newest first', () => {
    const today = session('today', at(10))
    const yesterday = session('yesterday', at(10, -1))
    const grouped = groupByPracticeDay([today, yesterday])
    expect(grouped).toHaveLength(2)
    expect(grouped[0].sessions.map((s) => s.id)).toEqual(['today'])
    expect(grouped[1].sessions.map((s) => s.id)).toEqual(['yesterday'])
  })
})

describe('formatDayHeader', () => {
  it('labels the current practice day "Today"', () => {
    expect(formatDayHeader(practiceDayKey(at(10)), NOW)).toBe('Today')
  })

  it('labels the previous practice day "Yesterday"', () => {
    expect(formatDayHeader(practiceDayKey(at(10, -1)), NOW)).toBe('Yesterday')
  })

  it('formats an older day as a full date', () => {
    const formatted = formatDayHeader(practiceDayKey(at(10, -5)), NOW)
    expect(formatted).not.toBe('Today')
    expect(formatted).not.toBe('Yesterday')
    expect(formatted).toContain('2026')
  })
})

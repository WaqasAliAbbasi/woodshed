import { describe, expect, it } from 'vitest'
import { collapseEmptyWeeks, formatMinutes, groupByLessonWeek, isGap, longestRun, weekEndFor } from './lessonWeeks'

const at = (d: string, hh = 19) => new Date(`${d}T${String(hh).padStart(2, '0')}:00:00`).getTime()
const day = (d: string) => new Date(`${d}T00:00:00`).getTime()
let n = 0
const session = (d: string, minutes: number, hh = 19, lesson = false) => ({ id: `s${n++}`, startedAt: at(d, hh), endedAt: at(d, hh) + minutes * 60_000, lesson })
const isLesson = (s: { lesson: boolean }) => s.lesson
const SAT = 6
// Sun 22 Nov 2026.
const NOW = at('2026-11-22', 12)

describe('weekEndFor', () => {
  it('is the next lesson day on or after the day', () => {
    expect(weekEndFor(day('2026-11-22'), SAT)).toBe(day('2026-11-28'))
    expect(weekEndFor(day('2026-11-21'), SAT)).toBe(day('2026-11-21'))
  })

  it('falls back to Sunday with no lesson day', () => {
    expect(weekEndFor(day('2026-11-18'), undefined)).toBe(day('2026-11-22'))
  })
})

describe('groupByLessonWeek', () => {
  it('starts at the current week and runs back to the earliest session, newest first', () => {
    const weeks = groupByLessonWeek([session('2026-11-03', 13)], isLesson, SAT, NOW)
    expect(weeks.map((w) => w.end)).toEqual([day('2026-11-28'), day('2026-11-21'), day('2026-11-14'), day('2026-11-07')])
  })

  it('marks practice days, minutes, and keeps lessons apart', () => {
    const weeks = groupByLessonWeek(
      [session('2026-11-10', 20), session('2026-11-10', 10, 21), session('2026-11-12', 15), session('2026-11-14', 45, 10, true)],
      isLesson,
      SAT,
      NOW,
    )
    const w = weeks.find((x) => x.end === day('2026-11-14'))!
    expect(w.days).toEqual([false, false, true, false, true, false, false])
    expect(w.practiceDays).toBe(2)
    expect(w.practiceMinutes).toBe(45)
    expect(w.lessons).toHaveLength(1)
    expect(w.practice).toHaveLength(3)
    expect(w.onlyOnLessonDay).toBe(false)
  })

  it('flags a week whose only practice was on lesson day', () => {
    const weeks = groupByLessonWeek([session('2026-11-14', 36, 8), session('2026-11-14', 45, 10, true)], isLesson, SAT, NOW)
    expect(weeks.find((x) => x.end === day('2026-11-14'))!.onlyOnLessonDay).toBe(true)
  })

  it('counts a session just after midnight towards the day before', () => {
    const weeks = groupByLessonWeek([session('2026-11-15', 20, 1)], isLesson, SAT, NOW)
    const w = weeks.find((x) => x.end === day('2026-11-14'))!
    expect(w.days[6]).toBe(true)
  })
})

describe('collapseEmptyWeeks', () => {
  it('folds two or more practice-free weeks into one gap, counting their lessons', () => {
    const weeks = groupByLessonWeek(
      [session('2026-11-19', 20), session('2026-10-31', 45, 10, true), session('2026-10-10', 30)],
      isLesson,
      SAT,
      NOW,
    )
    const entries = collapseEmptyWeeks(weeks)
    // 28 Nov (empty), 21 Nov (practice), then 14 Nov … 17 Oct empty (five weeks), 10 Oct practice.
    expect(isGap(entries[0])).toBe(false)
    expect(isGap(entries[1])).toBe(false)
    const gap = entries[2]
    expect(isGap(gap) && gap.weeks.length).toBe(5)
    expect(isGap(gap) && gap.lessonCount).toBe(1)
    expect(isGap(entries[3])).toBe(false)
  })

  it('leaves a single empty week as it is', () => {
    const weeks = groupByLessonWeek([session('2026-11-19', 20), session('2026-11-05', 20)], isLesson, SAT, NOW)
    expect(collapseEmptyWeeks(weeks).some(isGap)).toBe(false)
  })
})

describe('longestRun', () => {
  it('finds the longest run of consecutive days', () => {
    expect(longestRun([day('2026-07-20'), day('2026-07-21'), day('2026-07-22'), day('2026-07-25'), day('2026-07-21')])).toBe(3)
    expect(longestRun([])).toBe(0)
  })
})

describe('formatMinutes', () => {
  it('reads like the artboards', () => {
    expect(formatMinutes(36)).toBe('36 min')
    expect(formatMinutes(65)).toBe('1 h 5 min')
    expect(formatMinutes(363)).toBe('6 h 3 min')
    expect(formatMinutes(120)).toBe('2 h')
  })
})

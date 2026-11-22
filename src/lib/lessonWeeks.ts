import { practiceDayKey } from './streak.ts'

/**
 * Lesson weeks: the seven practice days leading up to (and including) each
 * lesson day — how Sessions groups history and how Stats counts practice
 * days (docs/learning-path.md, "Sessions and Stats"). With no lesson day
 * set, weeks end on Sunday instead.
 *
 * Days are practice days (4am boundary, see streak.ts), so a late-night
 * session lands on the day it felt like.
 */

export interface WeekSession {
  id: string
  startedAt: number
  endedAt: number
}

export interface LessonWeek<T extends WeekSession> {
  /** Local midnight of the week's first day. */
  start: number
  /** Local midnight of the week's last day — the lesson day. */
  end: number
  /** Practice (not lesson) sessions, newest first. */
  practice: T[]
  /** Lesson sessions, newest first. */
  lessons: T[]
  /** Which of the seven days (oldest first) had practice. */
  days: boolean[]
  practiceDays: number
  practiceMinutes: number
  /** All of the week's practice fell on the lesson day itself. */
  onlyOnLessonDay: boolean
}

/** A run of two or more past weeks without home practice, shown as one line. */
export interface WeekGap<T extends WeekSession> {
  gap: true
  start: number
  end: number
  weeks: LessonWeek<T>[]
  lessonCount: number
}

function addDays(dayMs: number, n: number): number {
  const d = new Date(dayMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}

/** The last day of the lesson week `dayMs` falls in: the next lesson day on or after it (Sunday with none set). */
export function weekEndFor(dayMs: number, lessonWeekday: number | undefined): number {
  const weekday = lessonWeekday ?? 0
  const d = new Date(dayMs)
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), (weekday - d.getDay() + 7) % 7)
}

/** Whole days from `a` to `b` (both local midnights), DST-safe. */
function daysBetween(a: number, b: number): number {
  return Math.round((b - a) / 86_400_000)
}

/**
 * Every lesson week from the earliest session's through the one containing
 * `now`, newest first. `isLesson` tells lesson sessions from practice ones.
 */
export function groupByLessonWeek<T extends WeekSession>(sessions: T[], isLesson: (s: T) => boolean, lessonWeekday: number | undefined, now: number): LessonWeek<T>[] {
  const currentEnd = weekEndFor(practiceDayKey(now), lessonWeekday)
  const earliest = sessions.reduce((min, s) => Math.min(min, practiceDayKey(s.startedAt)), practiceDayKey(now))
  const firstEnd = weekEndFor(earliest, lessonWeekday)

  const weeks: LessonWeek<T>[] = []
  for (let end = currentEnd; end >= firstEnd; end = addDays(end, -7)) {
    weeks.push({ start: addDays(end, -6), end, practice: [], lessons: [], days: Array(7).fill(false), practiceDays: 0, practiceMinutes: 0, onlyOnLessonDay: false })
  }
  const byEnd = new Map(weeks.map((w) => [w.end, w]))

  for (const s of [...sessions].sort((a, b) => b.startedAt - a.startedAt)) {
    const day = practiceDayKey(s.startedAt)
    const week = byEnd.get(weekEndFor(day, lessonWeekday))
    if (!week) continue
    if (isLesson(s)) {
      week.lessons.push(s)
      continue
    }
    week.practice.push(s)
    week.days[daysBetween(week.start, day)] = true
    week.practiceMinutes += Math.max(0, s.endedAt - s.startedAt) / 60_000
  }

  for (const w of weeks) {
    w.practiceMinutes = Math.round(w.practiceMinutes)
    w.practiceDays = w.days.filter(Boolean).length
    w.onlyOnLessonDay = lessonWeekday !== undefined && w.practiceDays === 1 && w.days[6]
  }
  return weeks
}

/** Collapses runs of two or more practice-free weeks (lessons or not) into one gap entry. Order is kept. */
export function collapseEmptyWeeks<T extends WeekSession>(weeks: LessonWeek<T>[]): (LessonWeek<T> | WeekGap<T>)[] {
  const out: (LessonWeek<T> | WeekGap<T>)[] = []
  let run: LessonWeek<T>[] = []
  const flush = () => {
    if (run.length >= 2) {
      out.push({ gap: true, start: run.at(-1)!.start, end: run[0].end, weeks: run, lessonCount: run.reduce((n, w) => n + w.lessons.length, 0) })
    } else out.push(...run)
    run = []
  }
  for (const w of weeks) {
    if (w.practice.length === 0) run.push(w)
    else {
      flush()
      out.push(w)
    }
  }
  flush()
  return out
}

export function isGap<T extends WeekSession>(entry: LessonWeek<T> | WeekGap<T>): entry is WeekGap<T> {
  return 'gap' in entry
}

/** The longest run of consecutive practice days among `dayKeys` (local midnights). */
export function longestRun(dayKeys: number[]): number {
  const days = [...new Set(dayKeys)].sort((a, b) => a - b)
  let best = 0
  let run = 0
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && daysBetween(days[i - 1], days[i]) === 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

/** "36 min", "1 h 5 min", "6 h". */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}

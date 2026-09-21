/**
 * Practice days start at 4am local time, not midnight — a late-night session
 * (or one that runs past midnight) still counts for the day it felt like,
 * instead of splitting across two calendar days or crediting the wrong one.
 */
const DAY_BOUNDARY_HOUR = 4

/**
 * Maps a timestamp to the "practice day" it belongs to, as a local-midnight
 * epoch ms, after applying the day-boundary shift. Exported so anything
 * else grouping practice by day (the Sessions view's day headers) uses the
 * exact same 4am boundary the streak does — two different answers for
 * "which day did this session belong to" would be a confusing thing to
 * show on the same screen as the streak figure.
 */
export function practiceDayKey(timestampMs: number): number {
  const shifted = new Date(timestampMs - DAY_BOUNDARY_HOUR * 60 * 60 * 1000)
  return new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate()).getTime()
}

/**
 * The calendar day after `dayKeyMs` (itself a local-midnight epoch ms from
 * `practiceDayKey`). Built from date *components*, not `+ 24h`, so it's
 * correct across a DST transition — the two are 23h or 25h apart on the days
 * clocks change, and a raw millisecond diff would misclassify those days as
 * non-consecutive.
 */
function nextPracticeDay(dayKeyMs: number): number {
  const d = new Date(dayKeyMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

export interface StreakSummary {
  /**
   * Consecutive practice days up to and including today — or yesterday, if
   * today hasn't been practiced yet, since a streak isn't broken until a
   * full day actually elapses without a session. 0 with no practice history,
   * or if the last practiced day is further back than yesterday.
   */
  current: number
  /** The longest run of consecutive practice days anywhere in history — may be the same run as `current`, or an earlier one. 0 with no practice history. */
  longest: number
  /** The most recent practice day, as a local-midnight epoch ms (see `practiceDayKey`) — undefined with no history. */
  lastPracticedDay: number | undefined
}

/**
 * Derives a practice streak from raw attempt timestamps — nothing in the app
 * computes this today. Every attempt counts, aborted ones included, the same
 * way `pieceStats.ts` treats them: an aborted attempt still means the piano
 * got played that day. Counted across every piece, since a streak is about
 * showing up, not about any one piece's progress.
 */
export function computeStreak(attempts: { timestamp: number }[], now = Date.now()): StreakSummary {
  if (attempts.length === 0) return { current: 0, longest: 0, lastPracticedDay: undefined }

  const days = Array.from(new Set(attempts.map((a) => practiceDayKey(a.timestamp)))).sort((a, b) => a - b)

  let longest = 1
  let run = 1
  for (let i = 1; i < days.length; i++) {
    run = days[i] === nextPracticeDay(days[i - 1]) ? run + 1 : 1
    longest = Math.max(longest, run)
  }

  const today = practiceDayKey(now)
  const lastPracticedDay = days[days.length - 1]
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  let current = 0
  if (lastPracticedDay === today || lastPracticedDay === yesterday.getTime()) {
    current = 1
    for (let i = days.length - 1; i > 0; i--) {
      if (days[i] !== nextPracticeDay(days[i - 1])) break
      current += 1
    }
  }

  return { current, longest, lastPracticedDay }
}

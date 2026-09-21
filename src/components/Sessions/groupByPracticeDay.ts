import type { PracticeSession } from '../../lib/db/db'
import { practiceDayKey } from '../../lib/streak'

export interface SessionDayGroup {
  /** Local-midnight epoch ms, after the streak's 4am boundary shift — see `practiceDayKey`. */
  dayKey: number
  sessions: PracticeSession[]
}

/**
 * Groups sessions by the same 4am-boundary "practice day" the streak uses
 * (see `streak.ts`'s `practiceDayKey`), so a late-night session lands under
 * the day it felt like rather than splitting across midnight. Assumes
 * `sessions` is already newest-first (what `listSessions` returns) and
 * preserves that order across groups and within each one — this is purely
 * a grouping pass, not a sort.
 */
export function groupByPracticeDay(sessions: PracticeSession[]): SessionDayGroup[] {
  const groups: SessionDayGroup[] = []
  for (const session of sessions) {
    const dayKey = practiceDayKey(session.startedAt)
    const current = groups.at(-1)
    if (current && current.dayKey === dayKey) {
      current.sessions.push(session)
    } else {
      groups.push({ dayKey, sessions: [session] })
    }
  }
  return groups
}

/**
 * "Today" / "Yesterday" / a formatted date — the Sessions view's day
 * headers. Yesterday is computed from date *components*, not `- 24h`, for
 * the same reason `streak.ts`'s `nextPracticeDay` is: the two are 23h or
 * 25h apart on a DST-change day, and a raw millisecond diff would miss it.
 */
export function formatDayHeader(dayKeyMs: number, now = Date.now()): string {
  const today = practiceDayKey(now)
  if (dayKeyMs === today) return 'Today'
  const todayDate = new Date(today)
  const yesterday = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - 1).getTime()
  if (dayKeyMs === yesterday) return 'Yesterday'
  return new Date(dayKeyMs).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })
}

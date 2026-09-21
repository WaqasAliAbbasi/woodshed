import type { PracticeSession } from '../../lib/db/db'
import { practiceDayKey } from '../../lib/streak'

/**
 * Total practice minutes per practice day (the streak's 4am boundary — see
 * `streak.ts`), summed across every session (derived + manual) whose
 * window *starts* that day. A session that happens to straddle the
 * boundary is attributed wholly to the day it started — the same
 * simplification the streak itself makes (one practice day per session,
 * not a split across two).
 */
export function buildDailyMinutesMap(sessions: PracticeSession[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const session of sessions) {
    const dayKey = practiceDayKey(session.startedAt)
    const minutes = (session.endedAt - session.startedAt) / 60_000
    map.set(dayKey, (map.get(dayKey) ?? 0) + minutes)
  }
  return map
}

export interface HeatmapDay {
  /** Local-midnight epoch ms, after the streak's 4am boundary shift. */
  dayKey: number
  minutes: number
}

/**
 * The last `days` practice days ending today, oldest first, with every day
 * present (0 minutes where nothing was logged) — what the calendar heatmap
 * and the bucketing helpers below iterate over to lay out a fixed grid
 * regardless of gaps in practice.
 */
export function buildHeatmapDays(dailyMinutes: Map<number, number>, days: number, now = Date.now()): HeatmapDay[] {
  const today = practiceDayKey(now)
  const todayDate = new Date(today)
  const result: HeatmapDay[] = []
  for (let i = days - 1; i >= 0; i--) {
    const dayKey = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - i).getTime()
    result.push({ dayKey, minutes: dailyMinutes.get(dayKey) ?? 0 })
  }
  return result
}

export interface MinutesBucket {
  label: string
  minutes: number
}

/** One bar per practice day, oldest first — the 7d/30d ranges, dense enough to read one bar per day. */
export function dailyBuckets(dailyMinutes: Map<number, number>, days: number, now = Date.now()): MinutesBucket[] {
  return buildHeatmapDays(dailyMinutes, days, now).map((d) => ({
    label: new Date(d.dayKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    minutes: d.minutes,
  }))
}

/**
 * One bar per 7-day week, oldest first — the 1-year range, where a bar per
 * day (365 of them) would be too dense to read. Each bucket's label is the
 * date its week starts on.
 */
export function weeklyBuckets(dailyMinutes: Map<number, number>, weeks: number, now = Date.now()): MinutesBucket[] {
  const days = buildHeatmapDays(dailyMinutes, weeks * 7, now)
  const buckets: MinutesBucket[] = []
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7)
    const minutes = week.reduce((sum, d) => sum + d.minutes, 0)
    buckets.push({
      label: new Date(week[0].dayKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      minutes,
    })
  }
  return buckets
}

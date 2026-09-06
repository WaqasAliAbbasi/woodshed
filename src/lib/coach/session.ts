import type { Attempt } from '../db/db'

export interface SessionSummary {
  /** Sum of durationMs across attempts recorded on the current calendar day (local time). Attempts predating duration tracking contribute 0 — see Attempt.durationMs. */
  todayDurationMs: number
  /** Count of attempts recorded on the current calendar day. */
  todayAttemptCount: number
  /** Timestamp of the most recent attempt from a *prior* calendar day, if any. Undefined when every attempt is from today, or there's no history at all. */
  lastPracticedBeforeToday: number | undefined
}

function isSameLocalDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs)
  const b = new Date(bMs)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * A lightweight "session" concept derived entirely from existing attempt
 * timestamps — no new stored concept of a session, just grouping by
 * calendar day — so a piece's progress reads as continuous across days
 * ("12 minutes today", "picking back up from Tuesday") instead of a flat,
 * dateless list of attempts.
 */
export function summarizeSession(attempts: Attempt[], now = Date.now()): SessionSummary {
  let todayDurationMs = 0
  let todayAttemptCount = 0
  let lastPracticedBeforeToday: number | undefined

  for (const attempt of attempts) {
    if (isSameLocalDay(attempt.timestamp, now)) {
      todayDurationMs += attempt.durationMs ?? 0
      todayAttemptCount++
    } else if (lastPracticedBeforeToday === undefined || attempt.timestamp > lastPracticedBeforeToday) {
      lastPracticedBeforeToday = attempt.timestamp
    }
  }

  return { todayDurationMs, todayAttemptCount, lastPracticedBeforeToday }
}

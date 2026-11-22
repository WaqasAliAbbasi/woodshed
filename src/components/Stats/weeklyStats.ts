import type { LessonWeek, WeekSession } from '../../lib/lessonWeeks'

/** The weekly practice-days goal the Stats chart draws as a dashed line. */
export const GOAL_DAYS = 4

export interface MinutesSession extends WeekSession {
  /** Pieces this practice touched (empty when unknown). Its minutes are split evenly across them. */
  pieceIds: string[]
}

/**
 * Home-practice minutes per piece. A session that touched several pieces
 * has no honest finer split, so its span is shared evenly; one that names
 * no piece counts under `''` ("other practice").
 */
export function minutesByPiece(sessions: MinutesSession[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of sessions) {
    const minutes = Math.max(0, s.endedAt - s.startedAt) / 60_000
    const ids = s.pieceIds.length > 0 ? s.pieceIds : ['']
    for (const id of ids) out.set(id, (out.get(id) ?? 0) + minutes / ids.length)
  }
  return out
}

/** "4 or more practice days in 2 of the last 18 weeks" — the chart's title states the finding. */
export function goalHeadline(weeks: Pick<LessonWeek<WeekSession>, 'practiceDays'>[]): string {
  const met = weeks.filter((w) => w.practiceDays >= GOAL_DAYS).length
  return `${GOAL_DAYS} or more practice days in ${met} of the last ${weeks.length} week${weeks.length === 1 ? '' : 's'}`
}

/** "Three quarters", "About half", … — a share in words for a headline. */
export function shareInWords(share: number): string {
  if (share >= 0.95) return 'Nearly all'
  if (share >= 0.7) return 'Three quarters'
  if (share >= 0.6) return 'Most'
  if (share >= 0.45) return 'About half'
  if (share >= 0.3) return 'About a third'
  return 'A small share'
}

import type { Attempt } from './db/db'

export interface PieceStats {
  /** Sum of durationMs across this piece's attempts. Attempts recorded before duration tracking existed contribute 0, so this undercounts practice history predating that change. */
  totalDurationMs: number
  firstPracticedAt: number
  lastPracticedAt: number
}

/** Groups attempts by piece in one pass — avoids an N+1 query per piece in the library list. */
export function buildPieceStatsMap(attempts: Attempt[]): Map<string, PieceStats> {
  const map = new Map<string, PieceStats>()
  for (const attempt of attempts) {
    const existing = map.get(attempt.pieceId)
    if (!existing) {
      map.set(attempt.pieceId, {
        totalDurationMs: attempt.durationMs ?? 0,
        firstPracticedAt: attempt.timestamp,
        lastPracticedAt: attempt.timestamp,
      })
      continue
    }
    existing.totalDurationMs += attempt.durationMs ?? 0
    existing.firstPracticedAt = Math.min(existing.firstPracticedAt, attempt.timestamp)
    existing.lastPracticedAt = Math.max(existing.lastPracticedAt, attempt.timestamp)
  }
  return map
}

/**
 * Most-recently-practiced piece first. Pieces with no attempts sort after
 * every practiced piece, ordered newest-uploaded-first among themselves.
 */
export function sortPiecesByRecency<T extends { id: string; createdAt: number }>(
  pieces: T[],
  statsByPieceId: Map<string, PieceStats>,
): T[] {
  return pieces.slice().sort((a, b) => {
    const aLast = statsByPieceId.get(a.id)?.lastPracticedAt
    const bLast = statsByPieceId.get(b.id)?.lastPracticedAt
    if (aLast !== undefined && bLast !== undefined) return bLast - aLast
    if (aLast !== undefined) return -1
    if (bLast !== undefined) return 1
    return b.createdAt - a.createdAt
  })
}

/** "45m", "2h", "2h 15m" — rounded to the minute, since sub-minute precision isn't useful for a practice-time total. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000)
  if (totalMinutes < 1) return '<1m'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/** Date only (no time), per the piece library's "first/last practiced" display. */
export function formatPracticeDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

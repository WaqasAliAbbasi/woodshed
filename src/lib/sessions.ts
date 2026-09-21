// Explicit .ts extensions on any relative imports this file gains later
// (none today) — see db.ts's doc comment: server/queries.ts imports this
// module directly, unbundled, via Node's native ESM loader, which needs
// them even though Vite doesn't care either way.

/**
 * How close two practice windows have to be to count as one session — see
 * docs/sessions-plan.md's "Clustering rule". A forgiving default for a
 * practice tool, the same spirit as the timing tolerances in
 * `lib/scoring/matcher.ts`: a bathroom break mid-practice shouldn't split
 * one session into two.
 */
export const SESSION_GAP_MS = 20 * 60 * 1000

export interface PracticeWindow {
  /** epoch ms */
  startedAt: number
  /** epoch ms, >= startedAt */
  endedAt: number
}

/**
 * An attempt's practice window, derived from its *finish* timestamp and
 * duration. `Attempt.timestamp` is stamped by `recordAttempt` after the
 * attempt finalizes (see attemptsRepo.ts), not when it started — so the
 * window has to walk backward from it, not forward.
 */
export function attemptWindow(attempt: { timestamp: number; durationMs?: number }): PracticeWindow {
  const endedAt = attempt.timestamp
  return { startedAt: endedAt - (attempt.durationMs ?? 0), endedAt }
}

/** Whether two windows are close enough (within `gapMs`) to belong to the same session — touching or overlapping counts. */
export function windowsCluster(a: PracticeWindow, b: PracticeWindow, gapMs = SESSION_GAP_MS): boolean {
  return a.startedAt <= b.endedAt + gapMs && b.startedAt <= a.endedAt + gapMs
}

/** The smallest window containing both — used once a set of windows is known to belong to the same session. */
export function mergeWindows(a: PracticeWindow, b: PracticeWindow): PracticeWindow {
  return { startedAt: Math.min(a.startedAt, b.startedAt), endedAt: Math.max(a.endedAt, b.endedAt) }
}

/**
 * Groups windows into sessions by transitive closure of `windowsCluster` —
 * the one clustering primitive both the boot backfill and the
 * per-attempt-write assignment in `server/queries.ts` are built on, so
 * there's exactly one place that decides what "one session" means.
 *
 * A single left-to-right sweep after sorting by start time is enough to
 * find every connected component correctly (not just adjacent-pair
 * merges): the currently-open cluster's end can only grow as later,
 * later-starting windows join it, so a window that clusters with anything
 * already in the open cluster is caught by comparing against that cluster's
 * running (extended) end, transitively including windows it doesn't
 * directly overlap.
 */
export function clusterWindows<T extends PracticeWindow>(windows: T[], gapMs = SESSION_GAP_MS): T[][] {
  if (windows.length === 0) return []
  const sorted = windows.slice().sort((a, b) => a.startedAt - b.startedAt)

  const clusters: T[][] = []
  let current: T[] = [sorted[0]]
  let currentEnd = sorted[0].endedAt

  for (let i = 1; i < sorted.length; i++) {
    const w = sorted[i]
    if (w.startedAt <= currentEnd + gapMs) {
      current.push(w)
      currentEnd = Math.max(currentEnd, w.endedAt)
    } else {
      clusters.push(current)
      current = [w]
      currentEnd = w.endedAt
    }
  }
  clusters.push(current)
  return clusters
}

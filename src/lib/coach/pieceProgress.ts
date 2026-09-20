import type { Attempt, Section } from '../db/db.ts'
// Explicit .ts extension (unlike most imports in this codebase) so this
// module also resolves under Node's native ESM loader, not just Vite's
// bundler resolution — server/mcp.ts imports it directly, unbundled, to
// reuse this scoring logic instead of duplicating it server-side.
import { classifyAccuracy, timingQuality, type SectionStatus } from './suggestNextStep.ts'

export interface SectionProgress {
  section: Section
  attemptCount: number
  latest: Attempt
  best: Attempt
  status: SectionStatus
  /**
   * Whether this section has *ever* been played clean at or above the
   * piece's target tempo — what the score's per-measure shading colors
   * green.
   *
   * Deliberately not derived from `latest` the way `status` is. `status`
   * answers "how did it just go", which is what the post-attempt stamp
   * needs; this answers "have I got this yet", which has to survive a slow
   * warm-up run the next morning. Tie it to the latest attempt instead and
   * the map empties itself every time the student sensibly practices under
   * tempo. Raising the target re-grades it for free, since the bar moves
   * but each attempt keeps the tempo it was played at.
   */
  clearedAtTarget: boolean
}

/** Struggling sections sort first, ready ones last — the table doubles as a practice priority queue. */
const STATUS_RANK: Record<SectionStatus, number> = { struggling: 0, progressing: 1, ready: 2 }

function combinedScore(attempt: Attempt): number {
  return attempt.aggregate.pitchAccuracy + attempt.aggregate.timingAccuracy
}

/** Whether one attempt counts as having cleared the piece's target: played at or above it, run to the end, and clean by the same bar {@link classifyAccuracy} calls ready. */
function clearsTarget(attempt: Attempt, targetTempoBpm: number): boolean {
  if (attempt.aborted || attempt.tempoBpm < targetTempoBpm) return false
  return classifyAccuracy(attempt.aggregate.pitchAccuracy, timingQuality(attempt.aggregate)) === 'ready'
}

/**
 * Rolls up every attempt into one row per practiced section, struggling-first.
 * Sections with no attempts yet (created but never actually played, which
 * shouldn't normally happen since `resolveSection` only runs when an attempt
 * starts) are omitted rather than shown as an empty row.
 *
 * `targetTempoBpm` is the tempo the piece is being worked up to, and only
 * affects `clearedAtTarget`. It's a required parameter rather than an
 * optional one so that a caller has to decide what the target is instead of
 * silently getting `clearedAtTarget: false` everywhere; pass `undefined`
 * where no target is known (nothing can have cleared a bar that isn't set).
 */
export function summarizeSectionProgress(
  sections: Section[],
  attempts: Attempt[],
  targetTempoBpm: number | undefined,
): SectionProgress[] {
  const attemptsBySection = new Map<string, Attempt[]>()
  for (const attempt of attempts) {
    const list = attemptsBySection.get(attempt.sectionId)
    if (list) list.push(attempt)
    else attemptsBySection.set(attempt.sectionId, [attempt])
  }

  const summaries: SectionProgress[] = []
  for (const section of sections) {
    const sectionAttempts = attemptsBySection.get(section.id)
    if (!sectionAttempts || sectionAttempts.length === 0) continue

    const latest = sectionAttempts.reduce((a, b) => (a.timestamp > b.timestamp ? a : b))
    const best = sectionAttempts.reduce((a, b) => (combinedScore(b) > combinedScore(a) ? b : a))

    summaries.push({
      section,
      attemptCount: sectionAttempts.length,
      latest,
      best,
      status: classifyAccuracy(latest.aggregate.pitchAccuracy, timingQuality(latest.aggregate)),
      clearedAtTarget: targetTempoBpm !== undefined && sectionAttempts.some((a) => clearsTarget(a, targetTempoBpm)),
    })
  }

  return summaries.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.latest.timestamp - b.latest.timestamp)
}

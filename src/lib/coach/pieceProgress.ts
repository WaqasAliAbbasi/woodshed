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
}

/** Struggling sections sort first, ready ones last — the table doubles as a practice priority queue. */
const STATUS_RANK: Record<SectionStatus, number> = { struggling: 0, progressing: 1, ready: 2 }

function combinedScore(attempt: Attempt): number {
  return attempt.aggregate.pitchAccuracy + attempt.aggregate.timingAccuracy
}

/**
 * Rolls up every attempt into one row per practiced section, struggling-first.
 * Sections with no attempts yet (created but never actually played, which
 * shouldn't normally happen since `resolveSection` only runs when an attempt
 * starts) are omitted rather than shown as an empty row.
 */
export function summarizeSectionProgress(sections: Section[], attempts: Attempt[]): SectionProgress[] {
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
    })
  }

  return summaries.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.latest.timestamp - b.latest.timestamp)
}

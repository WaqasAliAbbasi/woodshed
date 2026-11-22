import type { Collection } from '../../lib/db/pathRepo'
import type { DailyPlan, PlanStep, PlanTarget } from '../../lib/path/buildDailyPlan'
import type { PathItem } from '../../lib/path/nextStep'

/**
 * URLs for the path screens. A step URL says *what* to play, never how far
 * along it is — that's always re-derived from attempts when the screen
 * opens, so a link copied to another device opens at the right rung.
 *
 *   /piece/:id                    piece overview
 *   /piece/:id/play               the piece's next path step
 *   /piece/:id/play?review=chunk:2  one run of something already ready
 *   …&step=<plan key>             opened from today's plan (ticks it off)
 *   …&win=1                       the plan's "end on a win" (then Finish)
 */
export function overviewHref(pieceId: string): string {
  return `/piece/${encodeURIComponent(pieceId)}`
}

export function freePracticeHref(pieceId: string): string {
  return `/piece/${encodeURIComponent(pieceId)}/free`
}

export function itemParam(item: PathItem | 'whole'): string {
  if (item === 'whole') return 'whole'
  return item.kind === 'chunk' ? `chunk:${item.idx}` : `join:${item.k}`
}

export function parseItemParam(value: string | null): PathItem | 'whole' | undefined {
  if (value === 'whole') return 'whole'
  const m = value?.match(/^(chunk|join):(\d+)$/)
  if (!m) return undefined
  return m[1] === 'chunk' ? { kind: 'chunk', idx: Number(m[2]) } : { kind: 'join', k: Number(m[2]) }
}

export function playHref(target: PlanTarget, step?: PlanStep): string {
  const params = new URLSearchParams()
  if (target.kind === 'review') params.set('review', itemParam(target.item))
  if (step) params.set('step', step.key)
  if (step?.kind === 'win') params.set('win', '1')
  const query = params.toString()
  return `/piece/${encodeURIComponent(target.pieceId)}/play${query ? `?${query}` : ''}`
}

/** Where "Finish now" goes: straight to the plan's win, or to the session end if there's nothing ready to win on. */
export function finishHref(plan: DailyPlan | undefined): string {
  const win = plan?.steps.find((s) => s.kind === 'win')
  return win ? playHref(win.target, win) : '/done'
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Book 2 · p. 57" / "ABRSM Grade 1" — where a piece lives, so rows are easy to tell apart. */
export function collectionLabel(pieceId: string, collections: Collection[]): string | undefined {
  const labels = collections.flatMap((c) => {
    const entry = c.pieces.find((p) => p.pieceId === pieceId)
    if (!entry) return []
    if (c.kind === 'exam') return [c.name]
    return [entry.page !== undefined ? `${c.name} · p. ${entry.page}` : c.name]
  })
  return labels.length > 0 ? labels.join(' · ') : undefined
}

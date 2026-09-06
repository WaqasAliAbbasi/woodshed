import type { Attempt } from '../db/db'
import type { MeasureRange } from '../musicxml/types'
import { classifyAccuracy, type SectionStatus } from './suggestNextStep'

/** Below this many note-results at a measure, there isn't enough signal to call it struggling/ready — leave it out rather than overreacting to a single missed note. */
const MIN_SAMPLE_SIZE = 3

export interface MeasureDifficulty {
  measureNumber: number
  status: SectionStatus
  sampleSize: number
}

/**
 * Rolls up every stored NoteResult across every attempt for a piece into a
 * per-measure struggling/progressing/ready status — the note-level
 * counterpart to `summarizeSectionProgress`'s per-section rollup. Reuses
 * `classifyAccuracy`'s thresholds (with timing accuracy fixed at a perfect
 * 1.0, since there's no per-note timing concept here — only whether it was
 * ever gotten right) so "struggling" means the same accuracy bar at both
 * granularities, and the same STATUS_COLOR palette in ScoreViewer paints
 * both consistently.
 *
 * 'extra' (wrong-note) results only carry a measureNumber for
 * SequenceMatcher/Notes mode (see NoteResult's doc) — Metronome-mode wrong
 * notes have no cursor to attribute a measure to and are excluded, same as
 * everywhere else measureNumber is used.
 */
export function computeMeasureDifficulty(attempts: Attempt[]): MeasureDifficulty[] {
  const totals = new Map<number, { correct: number; total: number }>()
  for (const attempt of attempts) {
    for (const result of attempt.noteResults) {
      if (result.measureNumber === undefined) continue
      const entry = totals.get(result.measureNumber) ?? { correct: 0, total: 0 }
      entry.total++
      if (result.classification === 'onTime' || result.classification === 'early' || result.classification === 'late') entry.correct++
      totals.set(result.measureNumber, entry)
    }
  }

  const difficulty: MeasureDifficulty[] = []
  for (const [measureNumber, { correct, total }] of totals) {
    if (total < MIN_SAMPLE_SIZE) continue
    difficulty.push({ measureNumber, status: classifyAccuracy(correct / total, 1), sampleSize: total })
  }
  return difficulty.sort((a, b) => a.measureNumber - b.measureNumber)
}

const STATUS_WEIGHT: Record<SectionStatus, number> = { struggling: 2, progressing: 1, ready: 0 }

/**
 * The worst `windowSize`-measure contiguous window with any attempted
 * measures inside it — "drill my problem measures". A window that overlaps
 * no measured data at all is skipped rather than winning by default (every
 * unattempted piece would otherwise "recommend" measure 1). Ties keep the
 * earliest window.
 */
export function findWorstWindow(
  difficulty: MeasureDifficulty[],
  windowSize: number,
  firstMeasure: number,
  lastMeasure: number,
): MeasureRange | undefined {
  const byMeasure = new Map(difficulty.map((d) => [d.measureNumber, d]))

  let best: { range: MeasureRange; score: number } | undefined
  for (let start = firstMeasure; start + windowSize - 1 <= lastMeasure; start++) {
    const end = start + windowSize - 1
    let score = 0
    let sampled = 0
    for (let m = start; m <= end; m++) {
      const entry = byMeasure.get(m)
      if (!entry) continue
      score += STATUS_WEIGHT[entry.status]
      sampled++
    }
    if (sampled === 0) continue
    if (!best || score > best.score) best = { range: { startMeasure: start, endMeasure: end }, score }
  }
  return best?.range
}

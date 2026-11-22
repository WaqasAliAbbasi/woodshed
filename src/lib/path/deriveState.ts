import { timingQuality } from '../coach/suggestNextStep.ts'
import type { Piece, Section } from '../db/db.ts'
import type { PlanPieceInput, PlanState } from './buildDailyPlan.ts'
import { piecePath, type PiecePath } from './nextStep.ts'
import { targetTempo, type Rung3Pass } from './tempo.ts'
import type { Chunk, LessonOutcome, PathAttempt } from './types.ts'

/** The overview fields this module reads — a structural subset of `PathOverview` (pathRepo.ts), so it stays testable without the repo layer. */
export interface DeriveInput {
  pieces: Pick<Piece, 'id' | 'title' | 'targetTempoBpm' | 'finishedAt'>[]
  chunks: Chunk[]
  sections: Section[]
  attempts: PathAttempt[]
  /** Newest first. */
  lessons: { startedAt: number; pieces: { pieceId: string; outcome: LessonOutcome; focus?: string }[] }[]
  collections: { kind: string; pieces: { pieceId: string }[] }[]
}

export interface DerivedState {
  paths: Map<string, PiecePath>
  targets: Map<string, number>
  rung3Passes: Rung3Pass[]
  plan: PlanState
}

/** Metronome-mode path rungs — the ones whose rhythm figure means anything. */
const TIMED_RUNGS = new Set(['metronome', 'tempo', 'join', 'seam', 'review'])

/**
 * Turns the one-read overview into everything the plan, library and piece
 * screens show: each chunked piece's path, every rung-3 pass in the library
 * (where a fresh chunk's metronome tempo starts), and the plan's input.
 * Pure — the screens call it on every load, so nothing here is ever stale.
 */
export function deriveState(input: DeriveInput, now: number): DerivedState {
  const chunksByPiece = groupBy(input.chunks, (c) => c.pieceId)
  const sectionsByPiece = groupBy(input.sections, (s) => s.pieceId)
  const attemptsByPiece = groupBy(input.attempts, (a) => a.pieceId)
  const sectionById = new Map(input.sections.map((s) => [s.id, s]))
  const examPieces = new Set(input.collections.filter((c) => c.kind === 'exam').flatMap((c) => c.pieces.map((p) => p.pieceId)))

  const paths = new Map<string, PiecePath>()
  const targets = new Map<string, number>()
  const rung3Passes: Rung3Pass[] = []

  for (const piece of input.pieces) {
    const target = targetTempo(piece.targetTempoBpm, undefined)
    targets.set(piece.id, target)
    const chunks = chunksByPiece.get(piece.id)
    if (!chunks?.length) continue
    const path = piecePath({
      chunks,
      sections: sectionsByPiece.get(piece.id) ?? [],
      attempts: attemptsByPiece.get(piece.id) ?? [],
      targetTempoBpm: target,
      now,
    })
    paths.set(piece.id, path)
    for (const c of path.chunks) {
      const { passedAt, passTempo } = c.progress.rung3
      if (c.repeatOf === undefined && passTempo !== undefined && passedAt !== undefined) rung3Passes.push({ tempoBpm: passTempo, passedAt })
    }
  }

  const latestLesson = input.lessons[0]
  const pieces: PlanPieceInput[] = input.pieces.map((piece) => {
    const lessonIndex = input.lessons.findIndex((l) => l.pieces.some((p) => p.pieceId === piece.id))
    const lesson = lessonIndex >= 0 ? input.lessons[lessonIndex] : undefined
    const row = lesson?.pieces.find((p) => p.pieceId === piece.id)
    const attempts = (attemptsByPiece.get(piece.id) ?? []).slice().sort((a, b) => a.timestamp - b.timestamp)
    const timed = attempts.filter((a) => !a.aborted && a.aggregate.expected > 0 && TIMED_RUNGS.has(sectionById.get(a.sectionId)?.rung ?? ''))
    const latestTimed = timed.at(-1)
    return {
      pieceId: piece.id,
      title: piece.title,
      lesson: lesson && row ? { outcome: row.outcome, at: lesson.startedAt, focus: row.focus, fromLatestLesson: lesson === latestLesson } : undefined,
      finished: piece.finishedAt !== undefined,
      inExam: examPieces.has(piece.id),
      path: paths.get(piece.id),
      lastPathAttemptAt: attempts.at(-1)?.timestamp,
      recentRhythm: latestTimed ? timingQuality(latestTimed.aggregate) : undefined,
      targetTempoBpm: targets.get(piece.id)!,
    }
  })

  return { paths, targets, rung3Passes, plan: { pieces } }
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sat 28 Nov". */
export function shortDate(ms: number): string {
  const d = new Date(ms)
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** The next lesson day on or after `now`'s day, at local midnight — undefined with no lesson day set. */
export function nextLessonDate(now: number, weekday: number | undefined): number | undefined {
  if (weekday === undefined) return undefined
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7))
  return d.getTime()
}

/** The most recent lesson day on or before `now`'s day — the Log lesson form's default date. */
export function lastLessonDate(now: number, weekday: number | undefined): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (weekday !== undefined) d.setDate(d.getDate() - ((d.getDay() - weekday + 7) % 7))
  return d.getTime()
}

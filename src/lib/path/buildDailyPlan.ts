import { describeItem, describeStep, type PathItem, type PiecePath } from './nextStep.ts'
import { startOfDay } from './rungProgress.ts'
import type { LessonOutcome } from './types.ts'

export const DEFAULT_BUDGET_MINUTES = 20
export const BUDGET_CHOICES = [10, 20, 30] as const

const WARMUP_MINUTES = 2
const BLOCK_MINUTES = 5
const REVIEW_MINUTES = 2
/** Blocks stop being added with this much budget left — it's kept for the win. */
const KEEP_FOR_WIN_MINUTES = 2
const MAX_BLOCKS_PER_PIECE = 2
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const RHYTHM_WORTH_NAMING = 0.7

export interface PlanPieceInput {
  pieceId: string
  title: string
  /** This piece's row in the most recent lesson that covered it. */
  lesson?: {
    outcome: LessonOutcome
    /** When that lesson was (epoch ms). */
    at: number
    focus?: string
    /** That lesson is the latest one logged — an older lesson's focus is stale. */
    fromLatestLesson: boolean
  }
  /** The teacher said Finished (pieces.finished_at). */
  finished: boolean
  inExam: boolean
  /** Undefined until the piece has been chunked. */
  path?: PiecePath
  /** Last attempt on any of this piece's path sections. */
  lastPathAttemptAt?: number
  /** Rhythm of the latest counted Metronome try on the path, 0–1 — for "rhythm was 62%". */
  recentRhythm?: number
  targetTempoBpm: number
}

export interface PlanState {
  pieces: PlanPieceInput[]
}

/** What a step opens: the piece's next path step, or one run of something already ready. */
export type PlanTarget = { pieceId: string; kind: 'next' } | { pieceId: string; kind: 'review'; item: PathItem | 'whole' }

export interface PlanStep {
  /** Stable across recomputes of the same day's plan — what "done" ticks are kept against. */
  key: string
  kind: 'warmup' | 'block' | 'review' | 'win'
  pieceId: string
  title: string
  /** "chunk 3 · build tempo". */
  what: string
  /** One line: why this, today. */
  why: string
  minutes: number
  target: PlanTarget
}

export interface DailyPlan {
  steps: PlanStep[]
  minutes: number
  /** Pieces the plan is working on, focus first. */
  activePieceIds: string[]
  /** The latest lesson's focus lines, shown at the top of the plan. */
  focus: { pieceId: string; title: string; focus: string }[]
}

function isActive(piece: PlanPieceInput, today: number): boolean {
  const lesson = piece.lesson
  if (piece.finished || !lesson) return false
  if (lesson.outcome === 'continue') return true
  // New joins the plan from the day after the lesson.
  return lesson.outcome === 'new' && startOfDay(lesson.at) < startOfDay(today)
}

function hasFocus(piece: PlanPieceInput): boolean {
  return Boolean(piece.lesson?.focus && piece.lesson.fromLatestLesson)
}

/** Build tempo is stuck today: stay at the last passed tempo and end there (docs/learning-path.md, "Rungs"). */
function endedForToday(path: PiecePath | undefined): boolean {
  const next = path?.next
  return next?.kind === 'chunk' && next.rung === 'tempo' && path!.chunks[next.idx].progress.rung4.stuck
}

function isReady(piece: PlanPieceInput): boolean {
  return piece.finished || piece.path?.complete === true
}

function nextWhat(piece: PlanPieceInput): string {
  if (!piece.path) return 'chunk 1 · notes'
  if (piece.path.complete) return 'whole piece · run-through'
  return describeStep(piece.path.next)
}

function firstBlockWhy(piece: PlanPieceInput): string {
  if (hasFocus(piece)) return `Your teacher's focus: ${piece.lesson!.focus}`
  if (piece.inExam && piece.recentRhythm !== undefined && piece.recentRhythm < RHYTHM_WORTH_NAMING) {
    return `Exam piece · rhythm was ${Math.round(piece.recentRhythm * 100)}%`
  }
  if (piece.lesson?.outcome === 'new') return 'New from the lesson'
  if (piece.path?.complete) return 'Ready: keep it warm for your lesson'
  return piece.inExam ? 'Exam piece' : 'Keep going, from the lesson'
}

function readiedItem(piece: PlanPieceInput): { item: PathItem | 'whole'; at: number } | undefined {
  if (piece.path?.lastReadied) {
    const { at, ...item } = piece.path.lastReadied
    return { item: item as PathItem, at }
  }
  return undefined
}

function itemWhat(piece: PlanPieceInput, item: PathItem | 'whole'): string {
  if (item === 'whole' || !piece.path) return 'whole piece'
  return describeItem(item, piece.path.chunks.length)
}

/**
 * Today's plan across every piece the last lesson assigned
 * (docs/learning-path.md, "Today's plan"). Pure, and recomputed every time
 * the plan opens, so nothing is ever overdue: a missed day just means the
 * next plan starts from wherever the attempts say things are.
 *
 * 1. Warm-up: the most recently readied chunk or join, once.
 * 2. Work blocks of about 5 minutes, round-robin across active pieces,
 *    focus pieces first; each is that piece's next step, at most 2 per
 *    piece, stopping with 2 minutes of budget left.
 * 3. A short weekly review for ready exam pieces, if there's room.
 * 4. End on a win: one run of something already ready, preferring the
 *    focus piece.
 */
export function buildDailyPlan(state: PlanState, today: number, budgetMinutes: number = DEFAULT_BUDGET_MINUTES): DailyPlan {
  const winMinutes = budgetMinutes <= 10 ? 1 : 2
  const active = state.pieces
    .filter((p) => isActive(p, today))
    .map((p, order) => ({ p, order }))
    .sort((a, b) => Number(hasFocus(b.p)) - Number(hasFocus(a.p)) || a.order - b.order)
    .map(({ p }) => p)

  const steps: PlanStep[] = []
  let used = 0

  // 1. Warm-up.
  const warmup = active
    .map((p) => ({ p, readied: readiedItem(p) }))
    .filter((x): x is { p: PlanPieceInput; readied: NonNullable<ReturnType<typeof readiedItem>> } => x.readied !== undefined)
    .sort((a, b) => b.readied.at - a.readied.at)[0]
  if (warmup && budgetMinutes >= WARMUP_MINUTES + BLOCK_MINUTES + KEEP_FOR_WIN_MINUTES) {
    steps.push({
      key: 'warmup',
      kind: 'warmup',
      pieceId: warmup.p.pieceId,
      title: warmup.p.title,
      what: itemWhat(warmup.p, warmup.readied.item),
      why: `Warm-up review at ${warmup.p.targetTempoBpm} bpm`,
      minutes: WARMUP_MINUTES,
      target: { pieceId: warmup.p.pieceId, kind: 'review', item: warmup.readied.item },
    })
    used += WARMUP_MINUTES
  }

  // 2. Work blocks, round-robin.
  const workable = active.filter((p) => !endedForToday(p.path))
  for (let turn = 0; turn < MAX_BLOCKS_PER_PIECE; turn++) {
    for (const p of workable) {
      if (used + BLOCK_MINUTES > budgetMinutes - KEEP_FOR_WIN_MINUTES) break
      if (turn > 0 && p.path?.complete) continue
      steps.push({
        key: `${p.pieceId}:block:${turn}`,
        kind: 'block',
        pieceId: p.pieceId,
        title: p.title,
        what: turn === 0 ? nextWhat(p) : `${nextWhat(p)} · second turn`,
        why: turn === 0 ? firstBlockWhy(p) : 'Second turn, after a break from it',
        minutes: BLOCK_MINUTES,
        target: p.path?.complete ? { pieceId: p.pieceId, kind: 'review', item: 'whole' } : { pieceId: p.pieceId, kind: 'next' },
      })
      used += BLOCK_MINUTES
    }
  }

  // 3. Weekly review for ready exam pieces that aren't being worked on.
  for (const p of state.pieces) {
    if (!p.inExam || !isReady(p) || active.includes(p)) continue
    if (p.lastPathAttemptAt !== undefined && today - p.lastPathAttemptAt < WEEK_MS) continue
    if (used + REVIEW_MINUTES > budgetMinutes - winMinutes) break
    steps.push({
      key: `${p.pieceId}:review`,
      kind: 'review',
      pieceId: p.pieceId,
      title: p.title,
      what: 'whole piece',
      why: 'Exam piece · weekly review',
      minutes: REVIEW_MINUTES,
      target: { pieceId: p.pieceId, kind: 'review', item: 'whole' },
    })
    used += REVIEW_MINUTES
  }

  // 4. End on a win.
  const focusFirst = [...active.filter(hasFocus), ...active.filter((p) => !hasFocus(p))]
  const fromActive = focusFirst.map((p) => ({ p, readied: readiedItem(p) })).find((x) => x.readied !== undefined)
  const readyPiece = state.pieces
    .filter((p) => isReady(p))
    .sort((a, b) => Number(b.inExam) - Number(a.inExam) || (b.lastPathAttemptAt ?? 0) - (a.lastPathAttemptAt ?? 0))[0]
  const win = fromActive
    ? { p: fromActive.p, item: fromActive.readied!.item }
    : readyPiece
      ? { p: readyPiece, item: 'whole' as const }
      : undefined
  if (win) {
    steps.push({
      key: 'win',
      kind: 'win',
      pieceId: win.p.pieceId,
      title: 'End on a win',
      what: `${win.p.title} · ${itemWhat(win.p, win.item)}`,
      why: `One run at ${win.p.targetTempoBpm} bpm`,
      minutes: winMinutes,
      target: { pieceId: win.p.pieceId, kind: 'review', item: win.item },
    })
    used += winMinutes
  }

  return {
    steps,
    minutes: used,
    activePieceIds: active.map((p) => p.pieceId),
    focus: active.filter(hasFocus).map((p) => ({ pieceId: p.pieceId, title: p.title, focus: p.lesson!.focus! })),
  }
}

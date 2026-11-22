import { classifyAccuracy, timingQuality } from '../coach/suggestNextStep.ts'
import type { AttemptAggregate } from '../scoring/types.ts'
import type { PathAttempt } from './types.ts'

/** Rungs 1 and 2 pass with this many wrong notes or fewer — never a perfect pass (docs/learning-path.md). */
export const NOTES_PASS_MAX_WRONG = 2
/** Tries in a row without passing before a rung offers a way round it. */
export const STUCK_AFTER_TRIES = 3

/** An attempt with nothing to play (a hand with no notes in range) teaches nothing and passes nothing. */
function counted(attempt: PathAttempt): boolean {
  return !attempt.aborted && attempt.aggregate.expected > 0
}

export function isNotesPass(aggregate: AttemptAggregate): boolean {
  return aggregate.expected > 0 && aggregate.extra <= NOTES_PASS_MAX_WRONG
}

/** "Ready" is exactly the coach's ready bucket: pitch ≥ 95% and rhythm ≥ 85% (see classifyAccuracy). */
export function isReadyAggregate(aggregate: AttemptAggregate): boolean {
  return aggregate.expected > 0 && classifyAccuracy(aggregate.pitchAccuracy, timingQuality(aggregate)) === 'ready'
}

export function isReadyAttempt(attempt: PathAttempt): boolean {
  return counted(attempt) && isReadyAggregate(attempt.aggregate)
}

/** Local midnight at the start of `now`'s day — "today" for the stuck rules, so yesterday's misses never carry over. */
export function startOfDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export interface RungState {
  passed: boolean
  passedAt?: number
  /** Counted (unaborted) tries at this rung, all time. */
  tries: number
  /** Tries today, in a row, since the last pass — what "stuck" is measured on. */
  missesToday: number
  stuck: boolean
}

function trailingMissesToday(attempts: PathAttempt[], passes: (a: PathAttempt) => boolean, now: number): number {
  const today = startOfDay(now)
  let misses = 0
  for (let i = attempts.length - 1; i >= 0; i--) {
    const attempt = attempts[i]
    if (attempt.timestamp < today || passes(attempt)) break
    misses++
  }
  return misses
}

function rungState(attempts: PathAttempt[], passes: (a: PathAttempt) => boolean, passedAt: number | undefined, now: number): RungState {
  const missesToday = passedAt === undefined ? trailingMissesToday(attempts, passes, now) : 0
  return {
    passed: passedAt !== undefined,
    passedAt,
    tries: attempts.length,
    missesToday,
    stuck: missesToday >= STUCK_AFTER_TRIES,
  }
}

export interface ChunkRungAttempts {
  /** Rung 1. Each carries the hand it was played with. */
  notesHand: (PathAttempt & { hand: 'left' | 'right' })[]
  notes: PathAttempt[]
  metronome: PathAttempt[]
  tempo: PathAttempt[]
}

export type ChunkRung = 'notes' | 'metronome' | 'tempo'

export interface ChunkProgress {
  rung1: RungState & { handsPassed: ('left' | 'right')[] }
  rung2: RungState
  rung3: RungState & { passTempo?: number }
  rung4: RungState & {
    /** Rung 4 wasn't needed: rung 3 already passed at the target. */
    skipped: boolean
    /** Ready tries at or above the target so far (two pass it). */
    readyAtTarget: number
    /** The most recent tempo passed at rung 4 (or rung 3's, before any) — where a stuck rung 4 stays. */
    lastPassedTempo?: number
  }
  /** The lowest rung still to pass, or 'ready'. Rung 1 is optional and never "current". */
  current: ChunkRung | 'ready'
  ready: boolean
  readyAt?: number
}

/**
 * Derives a chunk's whole ladder from its attempts — there's no stored
 * rung state anywhere (docs/learning-path.md, "Data"). Each list must be
 * chronological and include aborted attempts; they're left out here.
 *
 * - Rungs 1–2 (Notes): pass on one try with 2 wrong notes or fewer.
 * - Rung 3 (Metronome): ready twice in a row. Its pass tempo is the slower
 *   of that pair.
 * - Rung 4 (Build tempo): ready twice at or above the target — not
 *   necessarily in a row, since the tempo moves between tries. Skipped
 *   when rung 3 already passed at the target.
 *
 * Passing a higher rung counts as passing the ones below it: someone who
 * plays it ready with the metronome has the notes.
 */
export function rungProgress(attempts: ChunkRungAttempts, targetTempoBpm: number, now: number): ChunkProgress {
  const notesHand = attempts.notesHand.filter(counted)
  const notes = attempts.notes.filter(counted)
  const metronome = attempts.metronome.filter(counted)
  const tempo = attempts.tempo.filter(counted)

  const notesPass = (a: PathAttempt) => isNotesPass(a.aggregate)

  const rung1PassedAt = notesHand.find(notesPass)?.timestamp
  const handsPassed = (['right', 'left'] as const).filter((hand) => notesHand.some((a) => a.hand === hand && notesPass(a)))

  // Rung 3: the first pair of consecutive ready tries.
  let rung3PassedAt: number | undefined
  let rung3PassTempo: number | undefined
  for (let i = 1; i < metronome.length; i++) {
    if (isReadyAttempt(metronome[i - 1]) && isReadyAttempt(metronome[i])) {
      rung3PassedAt = metronome[i].timestamp
      rung3PassTempo = Math.min(metronome[i - 1].tempoBpm, metronome[i].tempoBpm)
      break
    }
  }

  const skipped = rung3PassTempo !== undefined && rung3PassTempo >= targetTempoBpm
  const readyAtTargetTries = tempo.filter((a) => isReadyAttempt(a) && a.tempoBpm >= targetTempoBpm)
  const rung4PassedAt = skipped ? rung3PassedAt : readyAtTargetTries[1]?.timestamp
  const lastPassedTempo = tempo.filter(isReadyAttempt).at(-1)?.tempoBpm ?? rung3PassTempo

  const rung4 = rungState(tempo, isReadyAttempt, rung4PassedAt, now)
  const rung3 = rungState(metronome, isReadyAttempt, rung3PassedAt ?? rung4PassedAt, now)
  const rung2PassedAt = notes.find(notesPass)?.timestamp ?? rung3.passedAt
  const rung2 = rungState(notes, notesPass, rung2PassedAt, now)
  const rung1 = rungState(notesHand, notesPass, rung1PassedAt, now)

  const ready = rung4.passed
  const current: ChunkProgress['current'] = ready ? 'ready' : !rung2.passed ? 'notes' : !rung3.passed ? 'metronome' : 'tempo'

  return {
    rung1: { ...rung1, handsPassed },
    rung2,
    rung3: { ...rung3, passTempo: rung3PassTempo },
    rung4: { ...rung4, skipped, readyAtTarget: Math.min(readyAtTargetTries.length, 2), lastPassedTempo },
    current,
    ready,
    readyAt: ready ? rung4PassedAt : undefined,
  }
}

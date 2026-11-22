import { timingQuality } from '../coach/suggestNextStep.ts'
import type { MeasureRange } from '../musicxml/types.ts'
import type { PracticeMode } from '../scoring/types.ts'
import { firstHalf } from './stepSettings.ts'
import { tenPercentSlower } from './tempo.ts'
import type { PathAttempt } from './types.ts'

/** An abort this quick usually means the chunk is too long or too fast right now. */
export const QUICK_STOP_MS = 15_000
const QUICK_STOPS_IN_A_ROW = 2
const RHYTHM_TRIES = 3
const RHYTHM_PITCH_AT_LEAST = 0.95
const RHYTHM_BELOW = 0.7

export type Nudge =
  | {
      kind: 'quick-stops'
      /** "Shorter: measures a–b only" — the first half of what was being played. */
      shorter: MeasureRange
      /** "Slower: 10% under this try". Absent in Notes mode, which has no tempo. */
      slowerBpm?: number
    }
  | {
      kind: 'rhythm'
      pitch: number
      rhythm: number
      /** Which way the timing drifts, when it clearly drifts one way. */
      drift?: 'late' | 'early'
    }

export interface NudgeInput {
  /** This rung's attempts, chronological, aborted ones included. */
  attempts: PathAttempt[]
  /** Start of the current practice session (epoch ms). Only this session's tries count. */
  sessionStart: number
  /** A nudge already shown for this rung this session — never show a second. */
  alreadyShown: boolean
  mode: PracticeMode
  range: MeasureRange
  tempoBpm: number
}

/**
 * The guardrails (docs/learning-path.md, "Guardrails"), as one choice card
 * at most once per rung per session:
 *
 * - Quick stops: two aborts in a row, each under 15 seconds → offer the
 *   first half, or 10% slower.
 * - Rhythm, not notes: across the last 3 tries, pitch ≥ 95% but rhythm
 *   under 70% → it's a counting problem; count aloud at the same tempo.
 *
 * Quick stops win when both apply: you can't fix your counting on a
 * passage you keep abandoning.
 */
export function nudgeFor(input: NudgeInput): Nudge | undefined {
  if (input.alreadyShown) return undefined
  const session = input.attempts.filter((a) => a.timestamp >= input.sessionStart)

  const lastTwo = session.slice(-QUICK_STOPS_IN_A_ROW)
  if (lastTwo.length === QUICK_STOPS_IN_A_ROW && lastTwo.every((a) => a.aborted && (a.durationMs ?? Infinity) < QUICK_STOP_MS)) {
    return {
      kind: 'quick-stops',
      shorter: firstHalf(input.range),
      slowerBpm: input.mode === 'metronome' ? tenPercentSlower(input.tempoBpm) : undefined,
    }
  }

  if (input.mode !== 'metronome') return undefined
  const counted = session.filter((a) => !a.aborted && a.aggregate.expected > 0).slice(-RHYTHM_TRIES)
  if (counted.length < RHYTHM_TRIES) return undefined
  const rhythmProblem = counted.every(
    (a) => a.aggregate.pitchAccuracy >= RHYTHM_PITCH_AT_LEAST && timingQuality(a.aggregate) < RHYTHM_BELOW,
  )
  if (!rhythmProblem) return undefined

  const average = (f: (a: PathAttempt) => number) => counted.reduce((sum, a) => sum + f(a), 0) / counted.length
  const late = counted.reduce((sum, a) => sum + a.aggregate.late, 0)
  const early = counted.reduce((sum, a) => sum + a.aggregate.early, 0)
  return {
    kind: 'rhythm',
    pitch: average((a) => a.aggregate.pitchAccuracy),
    rhythm: average((a) => timingQuality(a.aggregate)),
    drift: late > early * 2 ? 'late' : early > late * 2 ? 'early' : undefined,
  }
}

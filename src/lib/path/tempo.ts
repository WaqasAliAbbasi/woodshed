import { MAX_TEMPO_BPM, METRONOME_DIAL_BPM, MIN_TEMPO_BPM, nearestDialBpm } from '../musicxml/buildExpectedTimeline.ts'

/** What a piece is worked up to when neither the student nor the score says. */
export const FALLBACK_TARGET_BPM = 80
/** How far back a rung-3 pass on another piece still says something about today's hands. */
export const START_TEMPO_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
/** Start at this share of the target when there's no recent pass to go on. */
const DEFAULT_START_SHARE = 0.7
const STEP_UP = 1.1
const STEP_DOWN = 0.9

export interface TempoChoice {
  bpm: number
  /** One line for the screen: why this tempo, this try. */
  reason: string
}

/** The target: the piece's saved one, else the score's marking, else 80. */
export function targetTempo(savedTargetBpm: number | undefined, markedTempoBpm: number | undefined): number {
  return savedTargetBpm ?? markedTempoBpm ?? FALLBACK_TARGET_BPM
}

function clamp(bpm: number): number {
  return Math.min(MAX_TEMPO_BPM, Math.max(MIN_TEMPO_BPM, Math.round(bpm)))
}

/** The nearest metronome-dial marking. Below the dial's slowest marking (40) there's nothing to round to. */
export function dialRound(bpm: number): number {
  if (bpm < METRONOME_DIAL_BPM[0]) return clamp(bpm)
  return nearestDialBpm(bpm)
}

/** One dial marking below `bpm` (the largest marking strictly under it). */
export function dialStepBelow(bpm: number): number {
  const below = METRONOME_DIAL_BPM.filter((d) => d < bpm)
  return below.length > 0 ? below[below.length - 1] : clamp(bpm * STEP_DOWN)
}

/** About 10% above `bpm`, on the dial, and always actually above it. */
function dialStepUp(bpm: number): number {
  const up = dialRound(bpm * STEP_UP)
  if (up > bpm) return up
  return METRONOME_DIAL_BPM.find((d) => d > bpm) ?? clamp(bpm * STEP_UP)
}

/** About 10% below `bpm`, on the dial — the "slower" offer in a nudge or when rung 3 is stuck. */
export function tenPercentSlower(bpm: number): number {
  const down = dialRound(bpm * STEP_DOWN)
  return down < bpm ? down : dialStepBelow(bpm)
}

export interface Rung3Pass {
  tempoBpm: number
  passedAt: number
}

/**
 * Where rung 3 starts: the tempo of the student's most recent rung-3 pass
 * on any piece in the past 30 days, capped at this piece's target — the
 * hands that just managed that tempo elsewhere are the same hands — or 70%
 * of the target with no such pass. Rounded to the dial either way.
 */
export function startTempo(passes: Rung3Pass[], target: number, now: number): TempoChoice {
  const recent = passes
    .filter((p) => p.passedAt <= now && now - p.passedAt <= START_TEMPO_LOOKBACK_MS)
    .sort((a, b) => b.passedAt - a.passedAt)[0]
  if (recent) {
    const bpm = Math.min(dialRound(recent.tempoBpm), target)
    return { bpm, reason: bpm === target ? 'Your target' : `Your last metronome pass was at ${recent.tempoBpm}` }
  }
  const bpm = Math.min(dialRound(target * DEFAULT_START_SHARE), target)
  return { bpm, reason: bpm === target ? 'Your target' : `About 70% of your target, ${target}` }
}

export interface TempoTry {
  tempoBpm: number
  passed: boolean
}

/**
 * Rung 4's tempo for the next try, from the tries so far (chronological,
 * aborted ones already left out). After a pass at T, about 10% higher,
 * capped at the target; after a miss, one dial step below the last passed
 * tempo — so a miss never drops the student below what they've already
 * shown they can do by more than a notch. `rung3PassTempo` is the "last
 * passed" tempo before any rung-4 try exists.
 */
export function nextTryTempo(tries: TempoTry[], rung3PassTempo: number, target: number): TempoChoice {
  const lastPassed = [...tries].reverse().find((t) => t.passed)?.tempoBpm ?? rung3PassTempo
  const last = tries[tries.length - 1]

  if (!last || last.passed) {
    const from = last ? last.tempoBpm : rung3PassTempo
    const bpm = Math.min(dialStepUp(from), target)
    if (bpm === target) return { bpm, reason: from >= target ? 'Your target, again' : `Your target, after a pass at ${from}` }
    return { bpm, reason: `About 10% up, after a pass at ${from}` }
  }
  const bpm = Math.min(dialStepBelow(lastPassed), target)
  return { bpm, reason: `A little under, after a miss at ${last.tempoBpm}` }
}

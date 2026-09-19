import type { AttemptAggregate, PracticeMode } from '../scoring/types.ts'

/** Below this pitch accuracy on the most recent attempt, the section needs more repetition before anything else. */
const STRUGGLING_PITCH_ACCURACY = 0.8
/** Below this timing accuracy on the most recent attempt, the section needs more repetition before anything else. */
const STRUGGLING_TIMING_ACCURACY = 0.7
/** At/above this pitch accuracy, the section is solid enough to try faster. */
const READY_PITCH_ACCURACY = 0.95
/**
 * At/above this timing accuracy, the section is solid enough to try faster.
 * Lowered from 0.9: that bar was rarely clearable for a beginner given the
 * matcher's on-time window (see ON_TIME_MS in lib/scoring/matcher.ts), so
 * the coach would just keep saying "keep working" and never suggest a tempo
 * bump.
 */
const READY_TIMING_ACCURACY = 0.85

export type SectionStatus = 'struggling' | 'progressing' | 'ready'

/** Shared so every place a section's status reaches the UI (progress shelf, post-attempt stamp) uses the same word for it. */
export const SECTION_STATUS_LABEL: Record<SectionStatus, string> = {
  struggling: 'Struggling',
  progressing: 'Progressing',
  ready: 'Ready',
}

/** Classifies a single attempt's accuracy into struggling/progressing/ready — shared by `summarizeSectionProgress` and the post-attempt stamp so a section's status reads the same way everywhere. */
export function classifyAccuracy(pitchAccuracy: number, timingAccuracy: number): SectionStatus {
  if (pitchAccuracy < STRUGGLING_PITCH_ACCURACY || timingAccuracy < STRUGGLING_TIMING_ACCURACY) return 'struggling'
  if (pitchAccuracy >= READY_PITCH_ACCURACY && timingAccuracy >= READY_TIMING_ACCURACY) return 'ready'
  return 'progressing'
}

/**
 * The timing figure classifyAccuracy's thresholds are tuned against: rhythm
 * quality isolated from pitch accuracy (see `timingAccuracyOfCorrect`'s
 * doc). Falls back to the combined `timingAccuracy` for attempts persisted
 * before the isolated field existed, which held this exact semantic then.
 */
export function timingQuality(aggregate: AttemptAggregate): number {
  return aggregate.timingAccuracyOfCorrect ?? aggregate.timingAccuracy
}

/**
 * Whether Loop mode (see PracticeSession) should stop auto-repeating after this attempt.
 *
 * Metronome mode reuses classifyAccuracy, which genuinely varies with
 * performance quality since a note must land inside a timing window to
 * count as correct. Notes mode can't use that: SequenceMatcher requires
 * playing the right note to advance past it, so a *completed*, unaborted
 * attempt always has pitchAccuracy 1.0 by construction, no matter how many
 * wrong notes were fumbled along the way (see SequenceMatcher's own docs).
 * A fully clean pass — zero wrong-note attempts — is the one number there
 * that actually reflects reading fluency, so that's the bar instead.
 */
export function isReadyToStopLooping(mode: PracticeMode, aggregate: AttemptAggregate): boolean {
  if (mode === 'notes') return aggregate.extra === 0
  return classifyAccuracy(aggregate.pitchAccuracy, timingQuality(aggregate)) === 'ready'
}

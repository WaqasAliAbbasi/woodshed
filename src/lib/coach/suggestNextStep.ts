import type { Attempt, Section } from '../db/db'

export interface CoachSuggestion {
  headline: string
  detail?: string
}

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
const TEMPO_STEP_BPM = 10

export type SectionStatus = 'struggling' | 'progressing' | 'ready'

/**
 * Classifies a single attempt's accuracy into the same three bands
 * `suggestNextStep` uses for its headline — shared so the piece-wide
 * progress overview (heatmap + summary table) colors a section exactly the
 * way the coach would talk about it, instead of drifting to its own
 * thresholds over time.
 */
export function classifyAccuracy(pitchAccuracy: number, timingAccuracy: number): SectionStatus {
  if (pitchAccuracy < STRUGGLING_PITCH_ACCURACY || timingAccuracy < STRUGGLING_TIMING_ACCURACY) return 'struggling'
  if (pitchAccuracy >= READY_PITCH_ACCURACY && timingAccuracy >= READY_TIMING_ACCURACY) return 'ready'
  return 'progressing'
}

/**
 * A minimal rule-based "what should I practice next" suggestion, derived
 * from this piece's attempt history — the one thing the practice loop was
 * missing (see HistoryView, which used to just list past attempts and
 * suggest nothing). Looks only at the most recently attempted section,
 * since that's what the student was last working on; older sections aren't
 * weighed against each other here.
 */
export function suggestNextStep(sections: Section[], attempts: Attempt[]): CoachSuggestion {
  if (attempts.length === 0) {
    return {
      headline: 'Play through the piece to get started',
      detail: 'Click a measure range on the score below, pick a tempo, and take your first attempt.',
    }
  }

  const mostRecent = attempts.reduce((a, b) => (a.timestamp > b.timestamp ? a : b))
  const sectionById = new Map(sections.map((s) => [s.id, s]))
  const label = sectionById.get(mostRecent.sectionId)?.label ?? 'that section'
  const { pitchAccuracy, timingAccuracy } = mostRecent.aggregate
  const pitchPct = Math.round(pitchAccuracy * 100)
  const timingPct = Math.round(timingAccuracy * 100)
  const status = classifyAccuracy(pitchAccuracy, timingAccuracy)

  if (status === 'struggling') {
    return {
      headline: `Repeat ${label} at ${mostRecent.tempoBpm} BPM`,
      detail: `Last attempt: ${pitchPct}% pitch, ${timingPct}% timing — stay at this tempo until it's solid.`,
    }
  }

  if (status === 'ready') {
    return {
      headline: `Bump ${label} to ${mostRecent.tempoBpm + TEMPO_STEP_BPM} BPM`,
      detail: `Last attempt: ${pitchPct}% pitch, ${timingPct}% timing at ${mostRecent.tempoBpm} BPM — solid enough to push the tempo.`,
    }
  }

  return {
    headline: `Keep working ${label} at ${mostRecent.tempoBpm} BPM`,
    detail: `Last attempt: ${pitchPct}% pitch, ${timingPct}% timing — getting there.`,
  }
}

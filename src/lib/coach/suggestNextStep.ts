import type { Attempt } from '../db/db'
import type { AttemptAggregate, PracticeMode } from '../scoring/types'
import type { SectionProgress } from './pieceProgress'
import { summarizeSession } from './session'

export interface CoachSuggestion {
  headline: string
  detail?: string
  /** A "where you left off" / "how today's going" line — session continuity across days (see summarizeSession). Undefined when there's nothing worth saying (e.g. this is the first attempt ever). */
  sessionNote?: string
  /** Section labels also due for practice this session, beyond the primary `headline` — a glimpse of the queue past just the top pick. */
  alsoQueued?: string[]
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
/** How many sections beyond the primary suggestion to surface as "also queued". */
const ALSO_QUEUED_COUNT = 2

export type SectionStatus = 'struggling' | 'progressing' | 'ready'

/** Shared so every place a section's status reaches the UI (progress shelf, post-attempt stamp) uses the same word for it. */
export const SECTION_STATUS_LABEL: Record<SectionStatus, string> = {
  struggling: 'Struggling',
  progressing: 'Progressing',
  ready: 'Ready',
}

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

const DAY_NAME = new Intl.DateTimeFormat(undefined, { weekday: 'long' })

/** "today", "yesterday", or a weekday/date for anything older — matches how a person would actually describe when they last sat down with this piece. */
function describeDay(timestampMs: number, now: number): string {
  const msPerDay = 24 * 60 * 60 * 1000
  const daysAgo = Math.round((now - timestampMs) / msPerDay)
  if (daysAgo <= 0) return 'today'
  if (daysAgo === 1) return 'yesterday'
  if (daysAgo < 7) return DAY_NAME.format(timestampMs)
  return new Date(timestampMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * A "where you left off" line for session continuity across days — the
 * piece otherwise reads as a flat, dateless list of attempts (see this
 * module's doc discussion on session-awareness). Returns undefined when
 * there's nothing worth saying yet (no practice history at all).
 */
function buildSessionNote(attempts: Attempt[], now: number): string | undefined {
  if (attempts.length === 0) return undefined
  const { todayDurationMs, todayAttemptCount, lastPracticedBeforeToday } = summarizeSession(attempts, now)

  if (todayAttemptCount > 0) {
    const minutes = Math.max(1, Math.round(todayDurationMs / 60_000))
    return `${minutes} minute${minutes === 1 ? '' : 's'} in today's session so far.`
  }
  if (lastPracticedBeforeToday !== undefined) {
    return `Picking back up — you last practiced this piece ${describeDay(lastPracticedBeforeToday, now)}.`
  }
  return undefined
}

/**
 * A minimal rule-based "what should I practice next" suggestion. Built from
 * the same struggling-first priority queue `summarizeSectionProgress` rolls
 * up for the whole piece — not just whichever section happened to be
 * attempted most recently — so opening a piece after a week away suggests
 * the section that actually needs the work, not "keep going" on whatever
 * was open last time you closed the tab.
 */
export function suggestNextStep(progress: SectionProgress[], attempts: Attempt[], now = Date.now()): CoachSuggestion {
  if (progress.length === 0) {
    return {
      headline: 'Play through the piece to get started',
      detail: 'Click a measure range on the score below, pick a tempo, and take your first attempt.',
    }
  }

  // Already struggling-first, then oldest-attempted-first within a status — see summarizeSectionProgress.
  const [primary, ...rest] = progress
  const { section, latest, status } = primary
  const { pitchAccuracy, timingAccuracy } = latest.aggregate
  const pitchPct = Math.round(pitchAccuracy * 100)
  const timingPct = Math.round(timingAccuracy * 100)
  const label = section.label

  const sessionNote = buildSessionNote(attempts, now)
  const alsoQueued = rest.slice(0, ALSO_QUEUED_COUNT).map((p) => p.section.label)

  if (status === 'struggling') {
    return {
      headline: `Repeat ${label} at ${latest.tempoBpm} BPM`,
      detail: `Last attempt: ${pitchPct}% pitch, ${timingPct}% timing — stay at this tempo until it's solid.`,
      sessionNote,
      alsoQueued: alsoQueued.length > 0 ? alsoQueued : undefined,
    }
  }

  if (status === 'ready') {
    return {
      headline: `Bump ${label} to ${latest.tempoBpm + TEMPO_STEP_BPM} BPM`,
      detail: `Last attempt: ${pitchPct}% pitch, ${timingPct}% timing at ${latest.tempoBpm} BPM — solid enough to push the tempo.`,
      sessionNote,
      alsoQueued: alsoQueued.length > 0 ? alsoQueued : undefined,
    }
  }

  return {
    headline: `Keep working ${label} at ${latest.tempoBpm} BPM`,
    detail: `Last attempt: ${pitchPct}% pitch, ${timingPct}% timing — getting there.`,
    sessionNote,
    alsoQueued: alsoQueued.length > 0 ? alsoQueued : undefined,
  }
}

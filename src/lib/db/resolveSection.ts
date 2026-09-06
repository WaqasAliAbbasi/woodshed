import type { Section } from './db'
import { createSection, listSectionsForPiece } from './sectionsRepo'
import type { HandFilter } from '../musicxml/buildExpectedTimeline'
import type { MeasureRange } from '../musicxml/types'
import type { PracticeMode } from '../scoring/types'

/** Shared with PracticeSession's own section-label display, so the label shown while practicing always matches what gets stored. */
export const HAND_LABEL: Record<HandFilter, string> = { both: '', right: ' (Right hand)', left: ' (Left hand)' }

/** Same purpose as HAND_LABEL, for Notes-mode sections — metronome mode is the unmarked default. */
export const MODE_LABEL: Record<PracticeMode, string> = { metronome: '', notes: ' (Notes)' }

/**
 * Finds the existing section for this measure range + hand filter + practice
 * mode, or creates one. Each is part of a section's identity — "measures
 * 1-4, right hand only" is a different exercise from "measures 1-4, both
 * hands", and untimed note-reading practice is a different exercise from
 * tempo-locked practice on the same range — so none of these are ever merged
 * into shared history/progress.
 *
 * Sections created before hands-separate practice or Notes mode existed have
 * no `handFilter`/`mode` stored at all — treated as 'both'/'metronome' here
 * so old history keeps matching a fresh both-hands, metronome-mode attempt
 * on the same range, instead of spawning a redundant duplicate section.
 */
export async function resolveSection(
  pieceId: string,
  range: MeasureRange,
  tempoBpm: number,
  handFilter: HandFilter,
  mode: PracticeMode,
): Promise<Section> {
  const sections = await listSectionsForPiece(pieceId)
  const existing = sections.find(
    (s) =>
      s.startMeasure === range.startMeasure &&
      s.endMeasure === range.endMeasure &&
      (s.handFilter ?? 'both') === handFilter &&
      (s.mode ?? 'metronome') === mode,
  )
  if (existing) return existing
  return createSection({
    pieceId,
    label: `Measures ${range.startMeasure}-${range.endMeasure}${HAND_LABEL[handFilter]}${MODE_LABEL[mode]}`,
    startMeasure: range.startMeasure,
    endMeasure: range.endMeasure,
    defaultTempoBpm: tempoBpm,
    handFilter,
    mode,
  })
}

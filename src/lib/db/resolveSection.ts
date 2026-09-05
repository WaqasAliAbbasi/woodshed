import type { Section } from './db'
import { createSection, listSectionsForPiece } from './sectionsRepo'
import type { HandFilter } from '../musicxml/buildExpectedTimeline'
import type { MeasureRange } from '../musicxml/types'

/** Shared with PracticeSession's own section-label display, so the label shown while practicing always matches what gets stored. */
export const HAND_LABEL: Record<HandFilter, string> = { both: '', right: ' (Right hand)', left: ' (Left hand)' }

/**
 * Finds the existing section for this measure range + hand filter, or
 * creates one. Hand filter is part of a section's identity — "measures 1-4,
 * right hand only" is a different exercise from "measures 1-4, both hands",
 * with its own history and tempo progression, so they're never merged.
 *
 * Sections created before hands-separate practice existed have no
 * `handFilter` stored at all — treated as 'both' here so old history keeps
 * matching a fresh "both hands" attempt on the same range, instead of
 * spawning a redundant duplicate section.
 */
export async function resolveSection(
  pieceId: string,
  range: MeasureRange,
  tempoBpm: number,
  handFilter: HandFilter,
): Promise<Section> {
  const sections = await listSectionsForPiece(pieceId)
  const existing = sections.find(
    (s) => s.startMeasure === range.startMeasure && s.endMeasure === range.endMeasure && (s.handFilter ?? 'both') === handFilter,
  )
  if (existing) return existing
  return createSection({
    pieceId,
    label: `Measures ${range.startMeasure}-${range.endMeasure}${HAND_LABEL[handFilter]}`,
    startMeasure: range.startMeasure,
    endMeasure: range.endMeasure,
    defaultTempoBpm: tempoBpm,
    handFilter,
  })
}

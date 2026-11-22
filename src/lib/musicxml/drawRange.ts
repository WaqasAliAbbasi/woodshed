import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import type { MeasureRange } from './types'

/**
 * Draws only `range`'s measures (or the whole score when undefined) on the
 * next `osmd.render()` — the path's practice step shows just the chunk or
 * join being played, zoomed to fill the width (docs/learning-path.md,
 * "Practice step").
 *
 * Sets OSMD's draw-range rules by measure *index* directly rather than
 * through its `drawFromMeasureNumber` option: that option treats a pickup
 * bar inconsistently (number 1 maps to the pickup's index), and the rest of
 * this codebase speaks in `MeasureNumber`s, pickup = 0. Zeroing the two
 * `…Number` rules keeps `render()` from overwriting the indices again for a
 * score with a pickup.
 *
 * Nothing else needs to know: OSMD's cursor resets to the first drawn
 * measure, and every cursor walk here (`advanceCursorToMeasure`,
 * `buildExpectedTimeline`) starts from a reset and seeks forward by
 * measure number.
 */
export function applyDrawRange(osmd: OpenSheetMusicDisplay, range: MeasureRange | undefined): void {
  const rules = osmd.EngravingRules
  const measures = osmd.Sheet.SourceMeasures
  const indexOf = (n: number) => measures.findIndex((m) => m.MeasureNumber === n)
  const start = range ? indexOf(range.startMeasure) : -1
  const end = range ? indexOf(range.endMeasure) : -1
  if (range && start >= 0 && end >= start) {
    rules.MinMeasureToDrawIndex = start
    rules.MaxMeasureToDrawIndex = end
    rules.MinMeasureToDrawNumber = 0
    rules.MaxMeasureToDrawNumber = 0
    // A chunk on one line fills the width instead of bunching at the left.
    rules.StretchLastSystemLine = true
  } else {
    rules.MinMeasureToDrawIndex = 0
    rules.MaxMeasureToDrawIndex = Number.MAX_VALUE
    rules.MinMeasureToDrawNumber = 0
    rules.MaxMeasureToDrawNumber = Number.MAX_VALUE
    rules.StretchLastSystemLine = false
  }
}

/** "7-9" — identifies a drawn range, so a caller can tell whether the score already shows what it's about to play. */
export function rangeKey(range: MeasureRange | undefined): string | undefined {
  return range ? `${range.startMeasure}-${range.endMeasure}` : undefined
}

/** Roughly how wide one bar wants to be at zoom 1 (the `compacttight` layout), in CSS px. */
const BAR_PX_AT_ZOOM_1 = 230
export const FIT_MIN_ZOOM = 1
export const FIT_MAX_ZOOM = 1.7

/**
 * The zoom that makes `barCount` bars fill `widthPx` on one line, within
 * readable bounds: a long range wraps onto more lines at the minimum
 * instead of shrinking to fit.
 */
export function fitZoom(barCount: number, widthPx: number): number {
  if (barCount <= 0 || widthPx <= 0) return FIT_MIN_ZOOM
  const zoom = widthPx / (barCount * BAR_PX_AT_ZOOM_1)
  return Math.round(Math.min(FIT_MAX_ZOOM, Math.max(FIT_MIN_ZOOM, zoom)) * 100) / 100
}

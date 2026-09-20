import type { OpenSheetMusicDisplay, PointF2D } from 'opensheetmusicdisplay'

/**
 * How far a click may sit outside a measure's bounding box (in OSMD units,
 * 1 unit = 10 SVG px) and still count as that measure. Covers the gap
 * between a grand staff's staves; clicks in larger empty regions (between
 * systems, page margins) are ignored.
 */
const CLICK_TOLERANCE_UNITS = 3

export interface MeasureBoundingBox {
  measureNumber: number
  /** Which rendered system (staff row) this box belongs to, counted across every page. Lets callers line up per-measure drawing with the rest of its row. */
  systemIndex: number
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * Every real (non-ghost) measure's bounding box, in OSMD units — one entry
 * per staff a measure appears on (a grand staff piece has two entries per
 * measure number, one per staff). Shared by hit-testing (below) and by
 * anything else that needs to know where a measure was actually drawn (e.g.
 * painting per-measure progress on the score).
 */
export function getMeasureBoundingBoxes(osmd: OpenSheetMusicDisplay): MeasureBoundingBox[] {
  const boxes: MeasureBoundingBox[] = []
  let systemIndex = -1

  for (const page of osmd.GraphicSheet.MusicPages) {
    for (const system of page.MusicSystems) {
      systemIndex++
      for (const staffMeasures of system.GraphicalMeasures) {
        for (const measure of staffMeasures) {
          const measureNumber = measure.MeasureNumber
          // Systems can carry ghost measures after the final barline (key /
          // rhythm change targets) whose MeasureNumber is never set (< 0).
          // 0 is a real, clickable measure — OSMD numbers a pickup/anacrusis
          // measure at the start of a piece as 0, not 1 (see
          // buildExpectedTimeline's getSourceMeasure for the full story).
          if (!Number.isInteger(measureNumber) || measureNumber < 0) continue

          const bb = measure.PositionAndShape
          boxes.push({
            measureNumber,
            systemIndex,
            left: bb.AbsolutePosition.x + bb.BorderLeft,
            right: bb.AbsolutePosition.x + bb.BorderRight,
            top: bb.AbsolutePosition.y + bb.BorderTop,
            bottom: bb.AbsolutePosition.y + bb.BorderBottom,
          })
        }
      }
    }
  }

  return boxes
}

/**
 * Finds the measure a click landed on, or undefined if it landed too far
 * from any measure.
 *
 * Deliberately does NOT use OSMD's `GetNearestObject(point,
 * GraphicalMeasure.name)`: the shipped OSMD bundle is minified, class
 * names are mangled per-module and COLLIDE — `GraphicalMeasure.name` is
 * "a", but ~10x more non-measure objects (staff entries etc.) are also
 * named "a", and `isInstanceOfClass` compares names only. The nearest "a"
 * object is usually a staff entry whose `MeasureNumber` is undefined, so
 * every click resolved to garbage. Comparing bounding boxes directly is
 * immune to all of that.
 */
export function findMeasureNumberAt(osmd: OpenSheetMusicDisplay, point: PointF2D): number | undefined {
  let nearest: { distanceSq: number; measureNumber: number } | undefined

  for (const box of getMeasureBoundingBoxes(osmd)) {
    if (point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom) {
      return box.measureNumber
    }

    const dx = Math.max(box.left - point.x, point.x - box.right, 0)
    const dy = Math.max(box.top - point.y, point.y - box.bottom, 0)
    const distanceSq = dx * dx + dy * dy
    if (!nearest || distanceSq < nearest.distanceSq) {
      nearest = { distanceSq, measureNumber: box.measureNumber }
    }
  }

  return nearest && nearest.distanceSq <= CLICK_TOLERANCE_UNITS ** 2 ? nearest.measureNumber : undefined
}

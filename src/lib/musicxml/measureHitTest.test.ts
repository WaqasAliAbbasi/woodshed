import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PointF2D, type GraphicalMeasure, type OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { loadScore } from './loadScore'
import { findMeasureNumberAt } from './measureHitTest'

// Real-world fixture: Clementi's Sonatina Op. 36 No. 1 (from OSMD's own test
// suite) — a two-part grand staff, which exercises the multi-staff case
// where a click must resolve to a measure number regardless of which staff
// it landed on.
const fixturePath = resolve(__dirname, './__fixtures__/clementi-sonatina.musicxml')
const musicXml = readFileSync(fixturePath, 'utf-8')

const PAGE_WIDTH_PX = 900

function allMeasures(osmd: OpenSheetMusicDisplay): GraphicalMeasure[] {
  const measures: GraphicalMeasure[] = []
  for (const page of osmd.GraphicSheet.MusicPages) {
    for (const system of page.MusicSystems) {
      for (const staffMeasures of system.GraphicalMeasures) {
        measures.push(...staffMeasures)
      }
    }
  }
  return measures
}

describe('findMeasureNumberAt', () => {
  let osmd: OpenSheetMusicDisplay
  let measures: GraphicalMeasure[]

  beforeAll(async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    // jsdom does no layout, so offsetWidth is 0 and OSMD would cram every
    // measure into a zero-width page. Fake a realistic browser width.
    Object.defineProperty(container, 'offsetWidth', { value: PAGE_WIDTH_PX })
    ;({ osmd } = await loadScore(container, musicXml))
    measures = allMeasures(osmd)
  })

  it('renders the fixture into multiple systems', () => {
    // Sanity check that the fake width produced a real layout — without it
    // every measure collapses onto the same x position and the test below
    // would pass vacuously.
    expect(measures.length).toBeGreaterThan(10)
    const firstSystem = osmd.GraphicSheet.MusicPages[0].MusicSystems[0]
    // GraphicalMeasures is [measureIndex][staffIndex]
    const first = firstSystem.GraphicalMeasures[0][0]
    const second = firstSystem.GraphicalMeasures[1][0]
    const firstRight = first.PositionAndShape.AbsolutePosition.x + first.PositionAndShape.BorderRight
    const secondRight = second.PositionAndShape.AbsolutePosition.x + second.PositionAndShape.BorderRight
    expect(secondRight).toBeGreaterThan(firstRight)
  })

  it('returns that measure when clicking the center of every measure', () => {
    // Regression: with OSMD's GetNearestObject this returned undefined for
    // all 76 measures — its class-name comparison hits minified-name
    // collisions and picks a non-measure object instead.
    for (const measure of measures) {
      const bb = measure.PositionAndShape
      const center = new PointF2D(
        bb.AbsolutePosition.x + (bb.BorderLeft + bb.BorderRight) / 2,
        bb.AbsolutePosition.y + (bb.BorderTop + bb.BorderBottom) / 2,
      )
      expect(findMeasureNumberAt(osmd, center)).toBe(measure.MeasureNumber)
    }
  })

  it('returns that measure when clicking sampled points inside every measure', () => {
    for (const measure of measures) {
      const bb = measure.PositionAndShape
      const left = bb.AbsolutePosition.x + bb.BorderLeft
      const right = bb.AbsolutePosition.x + bb.BorderRight
      const top = bb.AbsolutePosition.y + bb.BorderTop
      const bottom = bb.AbsolutePosition.y + bb.BorderBottom
      for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        for (const fy of [0.15, 0.5, 0.85]) {
          const point = new PointF2D(left + (right - left) * fx, top + (bottom - top) * fy)
          expect(findMeasureNumberAt(osmd, point)).toBe(measure.MeasureNumber)
        }
      }
    }
  })

  it('resolves clicks in the gap between a grand staff’s staves', () => {
    const firstSystem = osmd.GraphicSheet.MusicPages[0].MusicSystems[0]
    const upper = firstSystem.GraphicalMeasures[0][0]
    const lower = firstSystem.GraphicalMeasures[0][1]
    const upperBottom = upper.PositionAndShape.AbsolutePosition.y + upper.PositionAndShape.BorderBottom
    const lowerTop = lower.PositionAndShape.AbsolutePosition.y + lower.PositionAndShape.BorderTop
    const upperRight = upper.PositionAndShape.AbsolutePosition.x + upper.PositionAndShape.BorderRight
    const midGap = new PointF2D(upperRight / 2, (upperBottom + lowerTop) / 2)
    expect(findMeasureNumberAt(osmd, midGap)).toBe(1)
  })

  it('resolves a click on a pickup/anacrusis measure to measure 0, not undefined or the next measure', async () => {
    // OSMD numbers a piece-opening pickup measure 0 (an "implicit" measure,
    // auto-detected from its short duration) — a real measure that must
    // stay clickable, not treated like the negative-numbered ghost measures
    // OSMD can also emit after the final barline.
    const pickupXml = readFileSync(resolve(__dirname, './__fixtures__/pickup-measure.musicxml'), 'utf-8')
    const container = document.createElement('div')
    Object.defineProperty(container, 'offsetWidth', { value: PAGE_WIDTH_PX })
    document.body.appendChild(container)
    const { osmd: pickupOsmd } = await loadScore(container, pickupXml)
    const pickupMeasure = allMeasures(pickupOsmd).find((m) => m.MeasureNumber === 0)
    expect(pickupMeasure).toBeDefined()
    const bb = pickupMeasure!.PositionAndShape
    const center = new PointF2D(
      bb.AbsolutePosition.x + (bb.BorderLeft + bb.BorderRight) / 2,
      bb.AbsolutePosition.y + (bb.BorderTop + bb.BorderBottom) / 2,
    )
    expect(findMeasureNumberAt(pickupOsmd, center)).toBe(0)
  })

  it('ignores clicks far from any measure', () => {
    let maxBottom = 0
    for (const measure of measures) {
      const bb = measure.PositionAndShape
      maxBottom = Math.max(maxBottom, bb.AbsolutePosition.y + bb.BorderBottom)
    }
    // Well below the last system, beyond the click tolerance.
    expect(findMeasureNumberAt(osmd, new PointF2D(45, maxBottom + 10))).toBeUndefined()
    // Left of the page content entirely.
    expect(findMeasureNumberAt(osmd, new PointF2D(-50, 20))).toBeUndefined()
  })
})

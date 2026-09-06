import type { MeasureRange } from './types'

export interface CandidateSection {
  range: MeasureRange
  label: string
}

/** Target phrase length — not real phrase-boundary detection (that would need harmonic/cadence analysis), just a practical chunk size a beginner section is usually drilled at. */
const CHUNK_SIZE_MEASURES = 4

/**
 * Chops a piece into candidate practice sections of roughly `chunkSize`
 * measures each, so a freshly uploaded piece has somewhere to start besides
 * a blank score and two clicks. A short trailing remainder (less than half a
 * chunk) is folded into the previous section instead of standing alone as
 * its own 1-2 measure section.
 */
export function autoChopSections(
  firstMeasureNumber: number,
  lastMeasureNumber: number,
  chunkSize = CHUNK_SIZE_MEASURES,
): CandidateSection[] {
  if (lastMeasureNumber < firstMeasureNumber) return []

  const sections: CandidateSection[] = []
  let start = firstMeasureNumber
  while (start <= lastMeasureNumber) {
    let end = Math.min(start + chunkSize - 1, lastMeasureNumber)
    const remainder = lastMeasureNumber - end
    if (remainder > 0 && remainder < chunkSize / 2) end = lastMeasureNumber
    sections.push({ range: { startMeasure: start, endMeasure: end }, label: start === end ? `Measure ${start}` : `Measures ${start}–${end}` })
    start = end + 1
  }
  return sections
}

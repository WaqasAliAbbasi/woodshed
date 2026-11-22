import type { ScoreMeasure } from './scoreMeasures.ts'

/** One chunk as `chunkPiece` proposes it — before it's stored, so it has a position, not an id. */
export interface ChunkPlan {
  /** 0-based position in the piece. */
  idx: number
  startMeasure: number
  endMeasure: number
  /** `idx` of the earlier chunk this one copies note for note, if any — see `findRepeats`. */
  repeatOfIdx?: number
}

const GRID_BARS = 4
const MIN_BARS = 2

/**
 * How strongly a measure's *end* reads as the end of a phrase. Zero means
 * no evidence. A double barline or a fermata is the composer saying so
 * outright; a rest at the end of the bar is nearly as clear; a slur ending
 * is the weakest, since beginner pieces end slurs every bar or two.
 */
function phraseEvidence(measure: ScoreMeasure | undefined): number {
  if (!measure) return 0
  if (measure.doubleBarline || measure.fermata) return 3
  if (measure.restAtEnd) return 2
  if (measure.slurEnds) return 1
  return 0
}

/**
 * Splits a piece into chunks to learn one at a time (see
 * docs/learning-path.md, "Chunks"):
 *
 * - A 4-bar grid starting at the first full measure; a pickup joins chunk 1.
 * - Each grid boundary may move by at most one bar to land on phrase
 *   evidence. It stays put if the grid bar itself has any evidence, and
 *   otherwise moves to whichever neighbour has the stronger evidence
 *   (the earlier one on a tie — a shorter chunk is the easier one).
 * - Every chunk is 2–6 bars: boundaries 4 apart that each move at most 1
 *   can't produce anything outside that, and a final chunk shorter than 2
 *   bars merges into the one before it.
 *
 * Snapping never costs a repeat: if the plain grid finds more chunks that
 * repeat an earlier one than the snapped boundaries do, the grid wins.
 * Across the user's own library, about 4 in 10 measures repeat an earlier
 * one, and a repeat is a chunk with nothing new to learn — worth more than
 * a boundary that sits one bar closer to a slur ending.
 *
 * `snapToPhrases: false` gives the plain grid, with no boundary moves.
 */
export function chunkPiece(measures: ScoreMeasure[], options: { snapToPhrases?: boolean } = {}): ChunkPlan[] {
  const grid = findRepeats(measures, cutChunks(measures, false))
  if (options.snapToPhrases === false) return grid
  const snapped = findRepeats(measures, cutChunks(measures, true))
  const repeats = (chunks: ChunkPlan[]) => chunks.filter((c) => c.repeatOfIdx !== undefined).length
  return repeats(grid) > repeats(snapped) ? grid : snapped
}

function cutChunks(measures: ScoreMeasure[], snap: boolean): ChunkPlan[] {
  if (measures.length === 0) return []
  const full = measures.filter((m) => !m.pickup)
  if (full.length === 0) return [{ idx: 0, startMeasure: measures[0].number, endMeasure: measures[measures.length - 1].number }]

  const byNumber = new Map(measures.map((m) => [m.number, m]))
  const first = full[0].number
  const last = full[full.length - 1].number

  // Chunk ends, as measure numbers. The piece's last measure always ends one.
  const ends: number[] = []
  for (let gridEnd = first + GRID_BARS - 1; gridEnd < last; gridEnd += GRID_BARS) {
    let end = gridEnd
    if (snap && phraseEvidence(byNumber.get(gridEnd)) === 0) {
      const before = phraseEvidence(byNumber.get(gridEnd - 1))
      // Never move forward so far that the tail left after this boundary is
      // under 2 bars: merging that tail back would make a 7-bar chunk.
      const after = last - (gridEnd + 1) >= MIN_BARS ? phraseEvidence(byNumber.get(gridEnd + 1)) : 0
      if (before > 0 || after > 0) end = after > before ? gridEnd + 1 : gridEnd - 1
    }
    ends.push(end)
  }
  ends.push(last)

  // A final chunk under 2 bars merges into the previous one.
  if (ends.length > 1 && ends[ends.length - 1] - ends[ends.length - 2] < MIN_BARS) ends.splice(ends.length - 2, 1)

  const chunks: ChunkPlan[] = []
  let start = measures[0].number
  for (const end of ends) {
    chunks.push({ idx: chunks.length, startMeasure: start, endMeasure: end })
    start = end + 1
  }
  return chunks
}

function chunkSignature(byNumber: Map<number, ScoreMeasure>, chunk: ChunkPlan): string {
  const parts: string[] = []
  for (let m = chunk.startMeasure; m <= chunk.endMeasure; m++) parts.push(byNumber.get(m)?.signature ?? '')
  return parts.join(' | ')
}

/**
 * Marks each chunk whose notes are identical in both hands (pitch and
 * duration, bar for bar) to an earlier chunk with `repeatOfIdx`, always
 * pointing at the first occurrence — a copy of a copy points at the
 * original. A repeat is still played in joins; it just has nothing new to
 * learn on its own, so its status mirrors its source.
 */
export function findRepeats(measures: ScoreMeasure[], chunks: ChunkPlan[]): ChunkPlan[] {
  const byNumber = new Map(measures.map((m) => [m.number, m]))
  const firstBySignature = new Map<string, number>()
  return chunks.map((chunk) => {
    const signature = chunkSignature(byNumber, chunk)
    const source = firstBySignature.get(signature)
    if (source !== undefined) return { ...chunk, repeatOfIdx: source }
    firstBySignature.set(signature, chunk.idx)
    const { repeatOfIdx: _unused, ...rest } = chunk
    return rest
  })
}

/** Measures whose notes don't exactly repeat an earlier measure — the "M new" in "N bars, M new". */
export function countNewMeasures(measures: ScoreMeasure[]): number {
  const seen = new Set<string>()
  let fresh = 0
  for (const m of measures) {
    if (!seen.has(m.signature)) fresh++
    seen.add(m.signature)
  }
  return fresh
}

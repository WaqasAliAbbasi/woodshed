import { describe, expect, it } from 'vitest'
import { buildMusicXml, uniqueBar, type FixtureMeasure } from './__fixtures__/buildMusicXml'
import { chunkPiece, countNewMeasures, findRepeats } from './chunkPiece'
import { parseScore } from './scoreMeasures'

function bars(count: number, offset = 0): FixtureMeasure[] {
  return Array.from({ length: count }, (_, i) => uniqueBar(i + offset))
}

function ranges(xml: string, options?: { snapToPhrases?: boolean }) {
  return chunkPiece(parseScore(xml).measures, options).map((c) => [c.startMeasure, c.endMeasure, c.repeatOfIdx])
}

describe('parseScore', () => {
  it('numbers measures from 1, or from 0 when the first is a pickup — matching OSMD', () => {
    expect(parseScore(buildMusicXml(bars(3))).measures.map((m) => m.number)).toEqual([1, 2, 3])
    const pickup: FixtureMeasure = { rh: ['G4:1'], lh: ['r:1'] }
    const parsed = parseScore(buildMusicXml([pickup, ...bars(3)]))
    expect(parsed.measures.map((m) => m.number)).toEqual([0, 1, 2, 3])
    expect(parsed.measures[0].pickup).toBe(true)
  })

  it('reads phrase evidence: slur ends, fermatas, double barlines and a rest ending either hand', () => {
    const xml = buildMusicXml([
      { ...uniqueBar(1), slurEnd: true },
      { ...uniqueBar(2), fermata: true },
      { ...uniqueBar(3), doubleBarline: true },
      { rh: ['C5:2', 'D5:2'], lh: ['C3:2', 'r:2'] },
      { rh: ['C5:2', 'D5:2'], lh: ['C3:4'] },
    ])
    const [slur, fermata, double, rest, none] = parseScore(xml).measures
    expect(slur.slurEnds).toBe(true)
    expect(fermata.fermata).toBe(true)
    expect(double.doubleBarline).toBe(true)
    expect(rest.restAtEnd).toBe(true)
    expect([none.slurEnds, none.fermata, none.doubleBarline, none.restAtEnd]).toEqual([false, false, false, false])
  })

  it('reads the marked tempo', () => {
    expect(parseScore(buildMusicXml(bars(1), { tempo: 96 })).markedTempoBpm).toBe(96)
    expect(parseScore(buildMusicXml(bars(1))).markedTempoBpm).toBeUndefined()
  })

  it('gives identical bars identical signatures, and different hands different ones', () => {
    const [a, b, c] = parseScore(
      buildMusicXml([
        { rh: ['C5:4'], lh: ['C3:4'] },
        { rh: ['C5:4'], lh: ['C3:4'] },
        { rh: ['C5:4'], lh: ['D3:4'] },
      ]),
    ).measures
    expect(a.signature).toBe(b.signature)
    expect(a.signature).not.toBe(c.signature)
  })
})

describe('chunkPiece', () => {
  it('cuts a 4-bar grid that covers every bar', () => {
    expect(ranges(buildMusicXml(bars(16)))).toEqual([
      [1, 4, undefined],
      [5, 8, undefined],
      [9, 12, undefined],
      [13, 16, undefined],
    ])
  })

  it('puts a pickup into chunk 1 and merges a 1-bar tail into the chunk before it', () => {
    // Divertimento in D's shape: a pickup, then 16 full bars.
    const pickup: FixtureMeasure = { rh: ['A4:1'], lh: ['r:1'] }
    const chunks = ranges(buildMusicXml([pickup, ...bars(16)]))
    expect(chunks.map(([s, e]) => [s, e])).toEqual([
      [0, 4],
      [5, 8],
      [9, 12],
      [13, 16],
    ])
    // 17 full bars: the 17th would be a 1-bar chunk on its own.
    expect(ranges(buildMusicXml(bars(17))).at(-1)?.slice(0, 2)).toEqual([13, 17])
  })

  it('keeps every chunk between 2 and 6 bars, for any length', () => {
    for (let length = 2; length <= 40; length++) {
      const measures = bars(length).map((m, i) => (i % 3 === 0 ? { ...m, slurEnd: true } : m))
      for (const [start, end] of ranges(buildMusicXml(measures))) {
        const size = (end as number) - (start as number) + 1
        expect(size).toBeGreaterThanOrEqual(2)
        expect(size).toBeLessThanOrEqual(6)
      }
    }
  })

  it('moves a boundary by one bar onto phrase evidence, and keeps it when the grid bar has some', () => {
    const late = bars(12)
    late[4] = { ...late[4], slurEnd: true } // bar 5
    expect(ranges(buildMusicXml(late)).map(([s, e]) => [s, e])).toEqual([
      [1, 5],
      [6, 8],
      [9, 12],
    ])

    const early = bars(12)
    early[2] = { ...early[2], doubleBarline: true } // bar 3
    expect(ranges(buildMusicXml(early))[0].slice(0, 2)).toEqual([1, 3])

    const onGrid = bars(12)
    onGrid[3] = { ...onGrid[3], slurEnd: true } // bar 4 itself
    onGrid[4] = { ...onGrid[4], fermata: true } // bar 5, stronger, but bar 4 already qualifies
    expect(ranges(buildMusicXml(onGrid))[0].slice(0, 2)).toEqual([1, 4])
  })

  it('prefers the stronger evidence either side, and the earlier bar on a tie', () => {
    const stronger = bars(12)
    stronger[2] = { ...stronger[2], slurEnd: true } // bar 3, weak
    stronger[4] = { ...stronger[4], fermata: true } // bar 5, strong
    expect(ranges(buildMusicXml(stronger))[0].slice(0, 2)).toEqual([1, 5])

    const tie = bars(12)
    tie[2] = { ...tie[2], slurEnd: true }
    tie[4] = { ...tie[4], slurEnd: true }
    expect(ranges(buildMusicXml(tie))[0].slice(0, 2)).toEqual([1, 3])
  })

  it("marks repeats on the plain grid — You're In My Heart's shape: chunks 3, 6, 7 copy 1, 4, 5", () => {
    const c1 = bars(4, 0)
    const c2 = bars(4, 10)
    const c4 = bars(4, 20)
    const c5 = bars(4, 30)
    const c8 = bars(4, 40)
    const xml = buildMusicXml([...c1, ...c2, ...c1, ...c4, ...c5, ...c4, ...c5, ...c8], { beats: 3 })
    const chunks = chunkPiece(parseScore(xml).measures, { snapToPhrases: false })
    expect(chunks.map((c) => c.repeatOfIdx)).toEqual([undefined, undefined, 0, undefined, undefined, 3, 4, undefined])
    expect(countNewMeasures(parseScore(xml).measures)).toBe(20)
  })

  it("doesn't let snapping to a phrase cost a repeat", () => {
    // No evidence on bar 4, but a slur ends on bar 5: snapping would make
    // chunk 1 bars 1–5 and break its match with bars 9–12.
    const a = bars(4, 0)
    const b = bars(4, 10)
    b[0] = { ...b[0], slurEnd: true }
    const xml = buildMusicXml([...a, ...b, ...a])
    expect(ranges(xml).map((r) => r[2])).toEqual([undefined, undefined, 0])
  })

  it('points a copy of a copy at the original', () => {
    const a = bars(4)
    const measures = parseScore(buildMusicXml([...a, ...a, ...a])).measures
    const chunks = findRepeats(measures, [
      { idx: 0, startMeasure: 1, endMeasure: 4 },
      { idx: 1, startMeasure: 5, endMeasure: 8 },
      { idx: 2, startMeasure: 9, endMeasure: 12 },
    ])
    expect(chunks.map((c) => c.repeatOfIdx)).toEqual([undefined, 0, 0])
  })

  it('needs notes in both hands to match, not just the melody', () => {
    const a = bars(4)
    const b = a.map((m) => ({ ...m, lh: ['B2:4'] }))
    expect(ranges(buildMusicXml([...a, ...b])).map((r) => r[2])).toEqual([undefined, undefined])
  })

  it('returns one chunk for a piece shorter than the grid', () => {
    expect(ranges(buildMusicXml(bars(3)))).toEqual([[1, 3, undefined]])
  })
})

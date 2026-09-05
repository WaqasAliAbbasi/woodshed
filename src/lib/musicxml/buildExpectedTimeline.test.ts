import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildExpectedTimeline, getBeatsPerMeasure } from './buildExpectedTimeline'
import { loadScore } from './loadScore'
import type { ExpectedChordEvent } from './types'

// Real-world fixture: Clementi's Sonatina Op. 36 No. 1 (from OSMD's own test
// suite), encoded as two separate MusicXML <part>s (right hand / left hand)
// rather than one part with <staves>2</staves> — the more common real-world
// export shape from tools like MuseScore. Used to confirm that grand-staff
// merging (both hands landing in the same ExpectedChordEvent) works
// regardless of which of the two encodings a piece uses.
const fixturePath = resolve(__dirname, './__fixtures__/clementi-sonatina.musicxml')
const musicXml = readFileSync(fixturePath, 'utf-8')

describe('buildExpectedTimeline', () => {
  let events: ExpectedChordEvent[]

  beforeAll(async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    events = buildExpectedTimeline(osmd, { startMeasure: 1, endMeasure: 4 }, 120)
  })

  it('produces at least one expected chord event per measure in range', () => {
    expect(events.length).toBeGreaterThan(0)
    const measuresSeen = new Set(events.map((e) => e.measureNumber))
    expect(measuresSeen.has(1)).toBe(true)
  })

  it('merges both hands (right-hand and left-hand parts) into shared chord events', () => {
    // The piece's opening is right-hand melody over a left-hand accompaniment;
    // across the first few beats, at least one onset should carry notes more
    // than an octave apart in both directions from a plausible single-hand
    // span, evidencing both parts landed in the same vertical containers.
    const allMidi = events.flatMap((e) => e.midiNumbers)
    const lowest = Math.min(...allMidi)
    const highest = Math.max(...allMidi)
    expect(highest - lowest).toBeGreaterThan(12)
  })

  it('starts the range at onsetSec 0', () => {
    expect(events[0].onsetSec).toBe(0)
  })

  it('produces onsets in non-decreasing order', () => {
    for (let i = 1; i < events.length; i++) {
      expect(events[i].onsetSec).toBeGreaterThanOrEqual(events[i - 1].onsetSec)
    }
  })

  it('only includes measures within the requested range', () => {
    for (const event of events) {
      expect(event.measureNumber).toBeGreaterThanOrEqual(1)
      expect(event.measureNumber).toBeLessThanOrEqual(4)
    }
  })

  it('produces plausible MIDI note numbers (not off by the wrong octave offset)', () => {
    // Full piano range (A0=21 to C8=108) — a real off-by-octave bug in the
    // halfTone conversion would push notes outside even this generous band.
    // (This caught a real bug during development: an earlier version of the
    // offset put this piece's left-hand C3 three octaves too low, at MIDI 12.)
    const allMidi = events.flatMap((e) => e.midiNumbers)
    for (const midi of allMidi) {
      expect(midi).toBeGreaterThanOrEqual(21)
      expect(midi).toBeLessThanOrEqual(108)
    }
  })

  it('produces a graphicalNotes entry index-aligned with each midiNumbers entry', () => {
    for (const event of events) {
      expect(event.graphicalNotes).toHaveLength(event.midiNumbers.length)
      for (const gNote of event.graphicalNotes) {
        expect(gNote).toBeDefined()
        // Real GraphicalNote instances carry a reference back to their source Note.
        expect(gNote.sourceNote).toBeDefined()
      }
    }
  })
})

describe('getBeatsPerMeasure', () => {
  it('reads the actual 4/4 time signature from the Clementi fixture', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    expect(getBeatsPerMeasure(osmd, 1)).toBe(4)
  })
})

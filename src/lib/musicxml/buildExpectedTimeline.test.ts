import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteMatcher } from '../scoring/matcher'
import {
  buildExpectedTimeline,
  getBeatsPerMeasure,
  getCountInBeats,
  getDefaultTempoBpm,
  getStaffCount,
  getTempoPresets,
  scrollCursorIntoView,
} from './buildExpectedTimeline'
import { loadScore } from './loadScore'
import type { ExpectedChordEvent } from './types'
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'

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

describe('buildExpectedTimeline hand filtering', () => {
  it('splits notes between hands with no overlap and no loss, matching the merged (both) timeline', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    const range = { startMeasure: 1, endMeasure: 4 }
    const both = buildExpectedTimeline(osmd, range, 120, 'both')
    const right = buildExpectedTimeline(osmd, range, 120, 'right')
    const left = buildExpectedTimeline(osmd, range, 120, 'left')

    const noteCount = (events: ExpectedChordEvent[]) => events.reduce((sum, e) => sum + e.midiNumbers.length, 0)

    expect(noteCount(right) + noteCount(left)).toBe(noteCount(both))
    expect(noteCount(right)).toBeGreaterThan(0)
    expect(noteCount(left)).toBeGreaterThan(0)
  })

  it('right-hand-only notes sit higher on average than left-hand-only notes', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    const range = { startMeasure: 1, endMeasure: 4 }
    const right = buildExpectedTimeline(osmd, range, 120, 'right')
    const left = buildExpectedTimeline(osmd, range, 120, 'left')
    const averageMidi = (events: ExpectedChordEvent[]) => {
      const all = events.flatMap((e) => e.midiNumbers)
      return all.reduce((sum, midi) => sum + midi, 0) / all.length
    }
    expect(averageMidi(right)).toBeGreaterThan(averageMidi(left))
  })

  it('a hand-filtered timeline still starts at onsetSec 0 on its own first note', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    const range = { startMeasure: 1, endMeasure: 4 }
    const right = buildExpectedTimeline(osmd, range, 120, 'right')
    const left = buildExpectedTimeline(osmd, range, 120, 'left')
    expect(right[0].onsetSec).toBe(0)
    expect(left[0].onsetSec).toBe(0)
  })

  it('tags every note in a hand-filtered timeline with the hand that was requested', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    const range = { startMeasure: 1, endMeasure: 4 }
    const right = buildExpectedTimeline(osmd, range, 120, 'right')
    const left = buildExpectedTimeline(osmd, range, 120, 'left')
    expect(right.flatMap((e) => e.hands).every((hand) => hand === 'right')).toBe(true)
    expect(left.flatMap((e) => e.hands).every((hand) => hand === 'left')).toBe(true)
  })

  it('tags both hands correctly within a single merged (both) timeline', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    const range = { startMeasure: 1, endMeasure: 4 }
    const both = buildExpectedTimeline(osmd, range, 120, 'both')
    const hands = new Set(both.flatMap((e) => e.hands))
    expect(hands).toEqual(new Set(['left', 'right']))
    for (const e of both) {
      expect(e.hands).toHaveLength(e.midiNumbers.length)
    }
  })
})

describe('getStaffCount', () => {
  it('counts 2 staves for a grand-staff piano piece', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    expect(getStaffCount(osmd)).toBe(2)
  })

  it('counts 1 staff for a single-staff piece', async () => {
    const compoundXml = readFileSync(resolve(__dirname, './__fixtures__/compound-6-8.musicxml'), 'utf-8')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, compoundXml)
    expect(getStaffCount(osmd)).toBe(1)
  })
})

describe('getBeatsPerMeasure', () => {
  it('reads the actual 4/4 time signature from the Clementi fixture', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    expect(getBeatsPerMeasure(osmd, 1)).toBe(4)
  })

  it('rescales a compound meter (6/8) to quarter-note-equivalent beats, not the raw numerator', async () => {
    const compoundXml = readFileSync(resolve(__dirname, './__fixtures__/compound-6-8.musicxml'), 'utf-8')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, compoundXml)
    // 6/8 -> 3 quarter-note beats per measure, not the raw numerator (6),
    // which would make the count-in/beat-indicator run 2x too long.
    expect(getBeatsPerMeasure(osmd, 1)).toBe(3)
  })
})

describe('getCountInBeats', () => {
  it('counts in a full lead-in bar for a normal (non-pickup) start measure', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    expect(getCountInBeats(osmd, 1, 1)).toBe(4)
  })

  it('scales the lead-in bar count by countInMeasures for a normal start measure', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    expect(getCountInBeats(osmd, 1, 2)).toBe(8)
  })

  it('counts in only the missing beats for a pickup/anacrusis start measure', async () => {
    // "Calypso Carnival" (Alfred Book 2) shape: a 1-beat pickup (two eighth
    // notes) in a nominal 4/4 bar, landing on beat 4 — count-in should click
    // "1-2-3" (3 beats), not a full "1-2-3-4" bar, so the pickup coincides
    // with where the click would fall instead of one beat too late.
    //
    // Measure number is 0, not 1: OSMD auto-detects an opening pickup as an
    // "implicit" measure and numbers it 0, shifting every later measure
    // down by one relative to the raw XML numbering (see
    // buildExpectedTimeline's getSourceMeasure).
    const pickupXml = readFileSync(resolve(__dirname, './__fixtures__/pickup-measure.musicxml'), 'utf-8')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, pickupXml)
    expect(getCountInBeats(osmd, 0, 1)).toBe(3)
  })

  it('a pickup start measure does not affect a range starting on a later, full measure', async () => {
    const pickupXml = readFileSync(resolve(__dirname, './__fixtures__/pickup-measure.musicxml'), 'utf-8')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, pickupXml)
    // The fixture's second (full) measure — OSMD numbers it 1, since the
    // pickup ahead of it took 0.
    expect(getCountInBeats(osmd, 1, 1)).toBe(4)
  })

  it('counts in a fractional beat for a pickup that starts mid-beat', async () => {
    // A single eighth-note pickup in 4/4 is a 0.5-beat measure — it lands on
    // "the and" of beat 3, not on a beat itself, unlike the 1-beat
    // ("Calypso Carnival"-shaped) pickup above. The count-in must reflect
    // that half beat (3.5, not 3 or 4) or every note in the resulting
    // attempt gets mistimed by half a beat relative to the click track —
    // this used to be rounded away to a whole beat.
    const pickupXml = readFileSync(resolve(__dirname, './__fixtures__/pickup-eighth-measure.musicxml'), 'utf-8')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, pickupXml)
    expect(getCountInBeats(osmd, 0, 1)).toBe(3.5)
  })
})

describe('getDefaultTempoBpm', () => {
  it('reads the tempo marking from a piece that has one', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, musicXml)
    expect(getDefaultTempoBpm(osmd)).toBe(156)
  })

  it('falls back to a default tempo for a piece with no tempo marking', async () => {
    const compoundXml = readFileSync(resolve(__dirname, './__fixtures__/compound-6-8.musicxml'), 'utf-8')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, compoundXml)
    expect(getDefaultTempoBpm(osmd)).toBe(80)
  })
})

describe('buildExpectedTimeline dense tuplets', () => {
  // Real-world worst case named in docs/coaching-gaps.md: heavy 16th-note-triplet
  // writing (Olympic Procession, Space Shuttle Blues, Hungarian Rhapsody No. 2).
  // This fixture stress-tests the extreme end of that -- four back-to-back
  // 16th-note triplets on one *repeated* pitch, ~83ms apart at 120 BPM, with no
  // pitch variation to disambiguate onsets. Confirms both that OSMD's tuplet
  // timing (time-modification) comes through buildExpectedTimeline correctly,
  // and that NoteMatcher's nearest-onset matching (see matcher.test.ts) holds up
  // end-to-end against a real dense-tuplet timeline, not just hand-picked onsets.
  const tupletXml = readFileSync(resolve(__dirname, './__fixtures__/dense-tuplets.musicxml'), 'utf-8')

  it('spaces four 16th-note-triplet onsets evenly at ~83ms apart at 120 BPM', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, tupletXml)
    const events = buildExpectedTimeline(osmd, { startMeasure: 1, endMeasure: 1 }, 120)

    // 12 tuplet notes + 2 trailing quarter notes.
    expect(events).toHaveLength(14)
    const tupletOnsets = events.slice(0, 12).map((e) => e.onsetSec)
    for (let i = 1; i < tupletOnsets.length; i++) {
      expect(tupletOnsets[i] - tupletOnsets[i - 1]).toBeCloseTo(1 / 12, 2) // 250ms eighth / 3 = ~83.3ms
    }
  })

  it('matches every note correctly when played in order with realistic timing jitter', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const { osmd } = await loadScore(container, tupletXml)
    const events = buildExpectedTimeline(osmd, { startMeasure: 1, endMeasure: 1 }, 120)

    const matcher = new NoteMatcher(events)
    // Deterministic jitter within a real player's timing wobble, alternating
    // direction so it never simply cancels out to "always early" or "always late".
    const jitterSec = [0, 0.02, -0.015, 0.01, -0.02, 0.015, 0, -0.01, 0.02, -0.015, 0.01, 0, 0, 0]
    events.forEach((event, i) => {
      const midi = event.midiNumbers[0]
      const result = matcher.noteOn(midi, event.onsetSec + jitterSec[i])
      expect(result.expectedOnsetSec).toBeCloseTo(event.onsetSec, 6)
    })

    const { aggregate } = matcher.finalize()
    expect(aggregate).toMatchObject({ expected: 14, correct: 14, missed: 0, extra: 0 })
  })
})

describe('getTempoPresets', () => {
  it('rounds 1/3 and 2/3 of the target to standard metronome markings, keeping the target exact', () => {
    expect(getTempoPresets(120)).toEqual([40, 80, 120])
  })

  it('rounds to the nearest dial marking even when the fraction falls between two', () => {
    // 156/3 = 52 (exact); 156*2/3 = 104 (exact)
    expect(getTempoPresets(156)).toEqual([52, 104, 156])
  })

  it('dedupes presets that collapse together for a very slow target', () => {
    const presets = getTempoPresets(40)
    expect(presets).toEqual([...new Set(presets)])
    expect(presets).toContain(40)
  })

  it('never suggests a preset outside the practice tempo range', () => {
    for (const target of [20, 40, 80, 156, 240]) {
      for (const preset of getTempoPresets(target)) {
        expect(preset).toBeGreaterThanOrEqual(20)
        expect(preset).toBeLessThanOrEqual(240)
      }
    }
  })
})

describe('scrollCursorIntoView', () => {
  function fakeOsmd(rect: Partial<DOMRect>): OpenSheetMusicDisplay {
    return {
      cursor: {
        cursorElement: { getBoundingClientRect: () => rect as DOMRect } as unknown as HTMLImageElement,
      },
    } as unknown as OpenSheetMusicDisplay
  }

  beforeEach(() => {
    vi.stubGlobal('scrollBy', vi.fn())
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
    document.documentElement.style.setProperty('--practice-deck-height', '200px')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.style.removeProperty('--practice-deck-height')
  })

  it('does not scroll when the cursor is already comfortably visible above the deck', () => {
    // usable area is 0-600 (800 viewport - 200 deck); well within margins
    scrollCursorIntoView(fakeOsmd({ top: 100, bottom: 140 } as DOMRect))
    expect(window.scrollBy).not.toHaveBeenCalled()
  })

  it('scrolls up when the cursor is hidden under the fixed practice deck', () => {
    scrollCursorIntoView(fakeOsmd({ top: 580, bottom: 620 } as DOMRect))
    expect(window.scrollBy).toHaveBeenCalledTimes(1)
    const arg = (window.scrollBy as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.top).toBeGreaterThan(0) // scroll the page down to move the cursor up out from under the deck
  })

  it('scrolls when the cursor is above the top edge', () => {
    scrollCursorIntoView(fakeOsmd({ top: -50, bottom: -10 } as DOMRect))
    expect(window.scrollBy).toHaveBeenCalledTimes(1)
    const arg = (window.scrollBy as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg.top).toBeLessThan(0) // scroll the page up to bring the cursor down into view
  })

  it('does nothing when there is no cursor element yet', () => {
    scrollCursorIntoView({ cursor: {} } as unknown as OpenSheetMusicDisplay)
    expect(window.scrollBy).not.toHaveBeenCalled()
  })
})

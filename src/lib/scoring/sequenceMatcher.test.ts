import type { GraphicalNote } from 'opensheetmusicdisplay'
import { describe, expect, it } from 'vitest'
import type { ExpectedChordEvent } from '../musicxml/types'
import { SequenceMatcher } from './sequenceMatcher'

function mockGraphicalNote(label: string): GraphicalNote {
  return { label } as unknown as GraphicalNote
}

function chord(midiNumbers: number[], hands?: ('left' | 'right')[], measureNumber = 1): ExpectedChordEvent {
  const graphicalNotes = midiNumbers.map((midi, i) => mockGraphicalNote(`m${midi}#${i}`))
  return {
    onsetSec: 0,
    durationSec: 0.5,
    midiNumbers,
    graphicalNotes,
    hands: hands ?? midiNumbers.map(() => 'right'),
    measureNumber,
  }
}

/**
 * Plays a note as part of whatever chord is in progress — every test that
 * isn't about the chord window (see CHORD_WINDOW_MS) plays at timestamp 0,
 * i.e. perfectly together, so it doesn't have to invent timings.
 */
function play(matcher: SequenceMatcher, midi: number, velocity?: number) {
  return matcher.noteOn(midi, 0, velocity)
}

describe('SequenceMatcher', () => {
  it('matches notes strictly in order, one chord at a time', () => {
    const matcher = new SequenceMatcher([chord([60]), chord([64])])
    expect(matcher.currentChord?.midiNumbers).toEqual([60])
    const first = play(matcher, 60)
    expect(first.classification).toBe('onTime')
    expect(matcher.currentChord?.midiNumbers).toEqual([64])
    const second = play(matcher, 64)
    expect(second.classification).toBe('onTime')
    expect(matcher.isComplete).toBe(true)
  })

  it('does not advance past the current chord on a wrong note (drill-style, not lenient)', () => {
    const matcher = new SequenceMatcher([chord([60]), chord([64])])
    const wrong = play(matcher, 61)
    expect(wrong.classification).toBe('extra')
    expect(matcher.currentChord?.midiNumbers).toEqual([60]) // still waiting on the same chord
    const correct = play(matcher, 60)
    expect(correct.classification).toBe('onTime')
    expect(matcher.currentChord?.midiNumbers).toEqual([64]) // now advanced
  })

  it('only advances once every note in a multi-note chord has been played', () => {
    const matcher = new SequenceMatcher([chord([60, 64, 67])])
    play(matcher, 60)
    expect(matcher.isComplete).toBe(false)
    play(matcher, 64)
    expect(matcher.isComplete).toBe(false)
    play(matcher, 67)
    expect(matcher.isComplete).toBe(true)
  })

  it('does not double-count a repeated pitch within a chord as one match for two notes', () => {
    const matcher = new SequenceMatcher([chord([60, 60])])
    expect(play(matcher, 60).classification).toBe('onTime')
    expect(matcher.isComplete).toBe(false)
    expect(play(matcher, 60).classification).toBe('onTime')
    expect(matcher.isComplete).toBe(true)
  })

  it('exposes only the not-yet-played graphical notes of the current chord, not ones already matched', () => {
    const event = chord([60, 64])
    const matcher = new SequenceMatcher([event])
    expect(matcher.currentRemainingGraphicalNotes).toHaveLength(2)
    play(matcher, 60)
    const after = matcher.currentRemainingGraphicalNotes
    expect(after).toEqual([event.graphicalNotes[1]]) // only the still-unplayed 64, not the just-matched 60
  })

  it('carries hand and velocity onto a matched result', () => {
    const matcher = new SequenceMatcher([chord([60], ['left'])])
    const result = play(matcher, 60, 90)
    expect(result.hand).toBe('left')
    expect(result.velocity).toBe(90)
  })

  it('a wrong note carries velocity but no hand (no expected note to attribute it to)', () => {
    const matcher = new SequenceMatcher([chord([60], ['left'])])
    const result = play(matcher, 61, 55)
    expect(result.velocity).toBe(55)
    expect(result.hand).toBeUndefined()
  })

  it('a wrong note part-way through a chord resets the whole chord — both hands have to land together', () => {
    const matcher = new SequenceMatcher([chord([48, 64], ['left', 'right'])])
    play(matcher, 48) // left hand lands
    expect(play(matcher, 65).classification).toBe('extra') // right hand fumbles
    // The left hand's note is no longer banked: playing just the right one now leaves the chord unfinished.
    play(matcher, 64)
    expect(matcher.isComplete).toBe(false)
    play(matcher, 48)
    expect(matcher.isComplete).toBe(true)
  })

  it('does not double-count the notes played before a mistake reset the chord', () => {
    const matcher = new SequenceMatcher([chord([48, 64], ['left', 'right'])])
    play(matcher, 48)
    play(matcher, 65) // wrong -> chord resets, the 48 is forgotten
    play(matcher, 48)
    play(matcher, 64)
    const { aggregate } = matcher.finalize()
    expect(aggregate).toMatchObject({ expected: 2, correct: 2, extra: 1, missed: 0 })
    expect(aggregate.pitchAccuracy).toBe(1)
  })

  it('flashes the whole reset chord on a wrong note, not just the half still unplayed', () => {
    const event = chord([48, 64], ['left', 'right'])
    const matcher = new SequenceMatcher([event])
    play(matcher, 48)
    play(matcher, 65)
    expect(matcher.currentRemainingGraphicalNotes).toEqual(event.graphicalNotes)
  })

  it('finalize marks a half-played chord as missed in full, along with every later chord', () => {
    const matcher = new SequenceMatcher([chord([60, 64]), chord([67])])
    play(matcher, 60) // only half of the first chord played — not banked, the chord never landed
    const { aggregate, noteResults } = matcher.finalize()
    expect(aggregate).toMatchObject({ expected: 3, correct: 0, missed: 3 })
    expect(noteResults.filter((r) => r.classification === 'missed')).toHaveLength(3)
  })

  it('finalize reports everything correct when the whole sequence was completed', () => {
    const matcher = new SequenceMatcher([chord([60]), chord([64])])
    play(matcher, 60)
    play(matcher, 64)
    const { aggregate } = matcher.finalize()
    expect(aggregate).toMatchObject({ expected: 2, correct: 2, missed: 0, extra: 0 })
  })

  it('finalize is idempotent — calling it twice does not double-report missed notes', () => {
    const matcher = new SequenceMatcher([chord([60])])
    matcher.finalize()
    const { aggregate } = matcher.finalize()
    expect(aggregate).toMatchObject({ expected: 1, missed: 1 })
  })

  it('wrong notes do not affect pitchAccuracy once the correct note is eventually played', () => {
    const matcher = new SequenceMatcher([chord([60])])
    play(matcher, 61) // wrong, retried
    play(matcher, 62) // wrong again
    play(matcher, 60) // correct
    const { aggregate } = matcher.finalize()
    expect(aggregate.expected).toBe(1)
    expect(aggregate.correct).toBe(1)
    expect(aggregate.extra).toBe(2)
    expect(aggregate.pitchAccuracy).toBe(1)
  })

  it('tags each result with the measure of the chord it ties to', () => {
    const matcher = new SequenceMatcher([chord([60], undefined, 1), chord([64], undefined, 2)])
    const wrong = play(matcher, 99) // extra, attributed to the current (measure 1) cursor
    const first = play(matcher, 60) // measure 1
    const second = play(matcher, 64) // measure 2
    expect(wrong.measureNumber).toBe(1)
    expect(first.measureNumber).toBe(1)
    expect(second.measureNumber).toBe(2)
  })

  it('tags missed notes at finalize with their own chord measure, not the cursor measure', () => {
    const matcher = new SequenceMatcher([chord([60], undefined, 1), chord([64], undefined, 5)])
    const { noteResults } = matcher.finalize() // nothing played -> both chords missed
    expect(noteResults.find((r) => r.expectedMidi === 60)?.measureNumber).toBe(1)
    expect(noteResults.find((r) => r.expectedMidi === 64)?.measureNumber).toBe(5)
  })

  it('will not let a chord be assembled a hand at a time — a late second hand starts the chord over', () => {
    const matcher = new SequenceMatcher([chord([48, 64], ['left', 'right'])])
    matcher.noteOn(48, 1000) // left hand lands
    matcher.noteOn(64, 1400) // right hand, a beat and a half later — too late to be the same chord
    expect(matcher.isComplete).toBe(false)
    // ...and it's the *64* that's now banked, not the stale 48: the chord restarted around it.
    expect(matcher.currentRemainingGraphicalNotes).toHaveLength(1)
    matcher.noteOn(48, 1420)
    expect(matcher.isComplete).toBe(true)
  })

  it('accepts a chord spread over an ordinary hand-to-hand gap', () => {
    const matcher = new SequenceMatcher([chord([48, 64], ['left', 'right'])])
    matcher.noteOn(48, 1000)
    matcher.noteOn(64, 1180) // within the window — a slightly rolled chord, not two separate stabs
    expect(matcher.isComplete).toBe(true)
  })

  it('measures the window from the chord\'s first note, so a slow arpeggio cannot creep through it', () => {
    const matcher = new SequenceMatcher([chord([48, 60, 64])])
    matcher.noteOn(48, 1000)
    matcher.noteOn(60, 1200) // still inside the window
    matcher.noteOn(64, 1400) // each note is close to the last, but the chord itself has taken 400ms
    expect(matcher.isComplete).toBe(false)
  })

  it('gives no credit for the notes of a chord whose window lapsed', () => {
    const matcher = new SequenceMatcher([chord([48, 64], ['left', 'right'])])
    matcher.noteOn(48, 1000)
    matcher.noteOn(64, 2000) // chord restarts around this note
    const { aggregate } = matcher.finalize()
    // Two notes were played correctly, but the chord never landed — nothing is banked.
    expect(aggregate).toMatchObject({ expected: 2, correct: 0, missed: 2, extra: 0 })
  })

  it('starts each chord\'s window fresh, so a pause between chords costs nothing', () => {
    const matcher = new SequenceMatcher([chord([60]), chord([64])])
    matcher.noteOn(60, 1000)
    matcher.noteOn(64, 9000) // long think between chords — fine, they were never one chord
    expect(matcher.isComplete).toBe(true)
  })
})

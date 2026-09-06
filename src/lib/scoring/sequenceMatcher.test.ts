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

describe('SequenceMatcher', () => {
  it('matches notes strictly in order, one chord at a time', () => {
    const matcher = new SequenceMatcher([chord([60]), chord([64])])
    expect(matcher.currentChord?.midiNumbers).toEqual([60])
    const first = matcher.noteOn(60)
    expect(first.classification).toBe('onTime')
    expect(matcher.currentChord?.midiNumbers).toEqual([64])
    const second = matcher.noteOn(64)
    expect(second.classification).toBe('onTime')
    expect(matcher.isComplete).toBe(true)
  })

  it('does not advance past the current chord on a wrong note (drill-style, not lenient)', () => {
    const matcher = new SequenceMatcher([chord([60]), chord([64])])
    const wrong = matcher.noteOn(61)
    expect(wrong.classification).toBe('extra')
    expect(matcher.currentChord?.midiNumbers).toEqual([60]) // still waiting on the same chord
    const correct = matcher.noteOn(60)
    expect(correct.classification).toBe('onTime')
    expect(matcher.currentChord?.midiNumbers).toEqual([64]) // now advanced
  })

  it('only advances once every note in a multi-note chord has been played', () => {
    const matcher = new SequenceMatcher([chord([60, 64, 67])])
    matcher.noteOn(60)
    expect(matcher.isComplete).toBe(false)
    matcher.noteOn(64)
    expect(matcher.isComplete).toBe(false)
    matcher.noteOn(67)
    expect(matcher.isComplete).toBe(true)
  })

  it('does not double-count a repeated pitch within a chord as one match for two notes', () => {
    const matcher = new SequenceMatcher([chord([60, 60])])
    expect(matcher.noteOn(60).classification).toBe('onTime')
    expect(matcher.isComplete).toBe(false)
    expect(matcher.noteOn(60).classification).toBe('onTime')
    expect(matcher.isComplete).toBe(true)
  })

  it('exposes only the not-yet-played graphical notes of the current chord, not ones already matched', () => {
    const event = chord([60, 64])
    const matcher = new SequenceMatcher([event])
    expect(matcher.currentRemainingGraphicalNotes).toHaveLength(2)
    matcher.noteOn(60)
    const after = matcher.currentRemainingGraphicalNotes
    expect(after).toEqual([event.graphicalNotes[1]]) // only the still-unplayed 64, not the just-matched 60
  })

  it('carries hand and velocity onto a matched result', () => {
    const matcher = new SequenceMatcher([chord([60], ['left'])])
    const result = matcher.noteOn(60, 90)
    expect(result.hand).toBe('left')
    expect(result.velocity).toBe(90)
  })

  it('a wrong note carries velocity but no hand (no expected note to attribute it to)', () => {
    const matcher = new SequenceMatcher([chord([60], ['left'])])
    const result = matcher.noteOn(61, 55)
    expect(result.velocity).toBe(55)
    expect(result.hand).toBeUndefined()
  })

  it('finalize marks the rest of the current chord and every later chord as missed when stopped early', () => {
    const matcher = new SequenceMatcher([chord([60, 64]), chord([67])])
    matcher.noteOn(60) // only half of the first chord played
    const { aggregate, noteResults } = matcher.finalize()
    expect(aggregate).toMatchObject({ expected: 3, correct: 1, missed: 2 })
    expect(noteResults.filter((r) => r.classification === 'missed')).toHaveLength(2)
  })

  it('finalize reports everything correct when the whole sequence was completed', () => {
    const matcher = new SequenceMatcher([chord([60]), chord([64])])
    matcher.noteOn(60)
    matcher.noteOn(64)
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
    matcher.noteOn(61) // wrong, retried
    matcher.noteOn(62) // wrong again
    matcher.noteOn(60) // correct
    const { aggregate } = matcher.finalize()
    expect(aggregate.expected).toBe(1)
    expect(aggregate.correct).toBe(1)
    expect(aggregate.extra).toBe(2)
    expect(aggregate.pitchAccuracy).toBe(1)
  })

  it('tags each result with the measure of the chord it ties to', () => {
    const matcher = new SequenceMatcher([chord([60], undefined, 1), chord([64], undefined, 2)])
    const wrong = matcher.noteOn(99) // extra, attributed to the current (measure 1) cursor
    const first = matcher.noteOn(60) // measure 1
    const second = matcher.noteOn(64) // measure 2
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
})

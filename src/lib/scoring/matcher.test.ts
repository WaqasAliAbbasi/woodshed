import type { GraphicalNote } from 'opensheetmusicdisplay'
import { describe, expect, it } from 'vitest'
import type { ExpectedChordEvent } from '../musicxml/types'
import { NoteMatcher } from './matcher'

/** Distinguishable stand-ins for real GraphicalNote instances, so tests can assert correspondence. */
function mockGraphicalNote(label: string): GraphicalNote {
  return { label } as unknown as GraphicalNote
}

function event(onsetSec: number, midiNumbers: number[], hands?: ('left' | 'right')[]): ExpectedChordEvent {
  const graphicalNotes = midiNumbers.map((midi, i) => mockGraphicalNote(`m${midi}#${i}`))
  return { onsetSec, durationSec: 0.5, midiNumbers, graphicalNotes, hands: hands ?? midiNumbers.map(() => 'right'), measureNumber: 1 }
}

describe('NoteMatcher', () => {
  it('classifies a note played exactly on time as onTime', () => {
    const matcher = new NoteMatcher([event(1.0, [60])])
    const result = matcher.noteOn(60, 1.0)
    expect(result.classification).toBe('onTime')
    expect(result.deltaMs).toBe(0)
  })

  it('classifies a note played slightly early/late but within ON_TIME_MS as onTime', () => {
    const matcher = new NoteMatcher([event(1.0, [60])])
    expect(matcher.noteOn(60, 1.0 - 0.03).classification).toBe('onTime')
  })

  it('classifies a note played well before the onset (but within ACCEPT_MS) as early', () => {
    const matcher = new NoteMatcher([event(1.0, [60])])
    const result = matcher.noteOn(60, 1.0 - 0.12)
    expect(result.classification).toBe('early')
    expect(result.deltaMs).toBeCloseTo(-120, 0)
  })

  it('classifies a note played well after the onset (but within ACCEPT_MS) as late', () => {
    const matcher = new NoteMatcher([event(1.0, [60])])
    const result = matcher.noteOn(60, 1.0 + 0.15)
    expect(result.classification).toBe('late')
    expect(result.deltaMs).toBeCloseTo(150, 0)
  })

  it('classifies a wrong pitch (not expected anywhere nearby) as extra', () => {
    const matcher = new NoteMatcher([event(1.0, [60])])
    const result = matcher.noteOn(61, 1.0)
    expect(result.classification).toBe('extra')
    expect(result.expectedMidi).toBeUndefined()
  })

  it('classifies a pitch played far outside ACCEPT_MS of its own onset as extra, not a match', () => {
    const matcher = new NoteMatcher([event(1.0, [60])])
    const result = matcher.noteOn(60, 1.0 + 0.5)
    expect(result.classification).toBe('extra')
  })

  it('matches every note in a chord independently', () => {
    const matcher = new NoteMatcher([event(1.0, [60, 64, 67])])
    expect(matcher.noteOn(60, 1.0).classification).toBe('onTime')
    expect(matcher.noteOn(64, 1.01).classification).toBe('onTime')
    expect(matcher.noteOn(67, 1.02).classification).toBe('onTime')
    const { aggregate } = matcher.finalize()
    expect(aggregate).toMatchObject({ expected: 3, correct: 3, missed: 0, extra: 0 })
  })

  it('does not double-count a repeated pitch within a chord as one match for two notes', () => {
    // A doubled unison (e.g. same pitch in two voices) requires two separate note-ons.
    const matcher = new NoteMatcher([event(1.0, [60, 60])])
    expect(matcher.noteOn(60, 1.0).classification).toBe('onTime')
    expect(matcher.noteOn(60, 1.0).classification).toBe('onTime')
    const { aggregate } = matcher.finalize()
    expect(aggregate.expected).toBe(2)
    expect(aggregate.correct).toBe(2)
  })

  it('a third play of an already-fully-matched doubled pitch counts as extra', () => {
    const matcher = new NoteMatcher([event(1.0, [60, 60])])
    matcher.noteOn(60, 1.0)
    matcher.noteOn(60, 1.0)
    const result = matcher.noteOn(60, 1.0)
    expect(result.classification).toBe('extra')
  })

  it('sweepMissed finalizes an unplayed note once its acceptance window has passed', () => {
    const matcher = new NoteMatcher([event(1.0, [60])])
    expect(matcher.sweepMissed(1.1)).toHaveLength(0) // still within ACCEPT_MS
    const missed = matcher.sweepMissed(1.3) // now past it
    expect(missed).toHaveLength(1)
    expect(missed[0].classification).toBe('missed')
  })

  it('sweepMissed does not re-report an already-swept event', () => {
    const matcher = new NoteMatcher([event(1.0, [60])])
    matcher.sweepMissed(2.0)
    expect(matcher.sweepMissed(3.0)).toHaveLength(0)
  })

  it('finalize force-closes still-open events regardless of timing', () => {
    const matcher = new NoteMatcher([event(1.0, [60]), event(2.0, [64])])
    matcher.noteOn(60, 1.0)
    const { aggregate, noteResults } = matcher.finalize()
    expect(aggregate).toMatchObject({ expected: 2, correct: 1, missed: 1 })
    expect(noteResults.filter((r) => r.classification === 'missed')).toHaveLength(1)
  })

  it('computes pitchAccuracy and timingAccuracy correctly across a realistic mixed attempt', () => {
    const matcher = new NoteMatcher([event(1.0, [60, 64]), event(2.0, [67])])
    matcher.noteOn(60, 1.0) // onTime
    matcher.noteOn(64, 1.15) // late but within accept window -> correct, not onTime
    matcher.noteOn(71, 2.0) // wrong note -> extra, doesn't fill the expected 67
    const { aggregate } = matcher.finalize() // 67 never played -> missed
    expect(aggregate.expected).toBe(3)
    expect(aggregate.correct).toBe(2)
    expect(aggregate.missed).toBe(1)
    expect(aggregate.extra).toBe(1)
    expect(aggregate.onTime).toBe(1)
    expect(aggregate.late).toBe(1)
    expect(aggregate.pitchAccuracy).toBeCloseTo(2 / 3)
    expect(aggregate.timingAccuracy).toBeCloseTo(1 / 2)
  })

  it('returns the graphicalNote corresponding to the matched pitch', () => {
    const ev = event(1.0, [60, 64, 67])
    const matcher = new NoteMatcher([ev])
    const result = matcher.noteOn(64, 1.0)
    expect(result.graphicalNote).toBe(ev.graphicalNotes[1])
  })

  it('pops a distinct graphicalNote instance for each play of a doubled pitch', () => {
    const ev = event(1.0, [60, 60])
    const matcher = new NoteMatcher([ev])
    const first = matcher.noteOn(60, 1.0)
    const second = matcher.noteOn(60, 1.0)
    expect(first.graphicalNote).not.toBe(second.graphicalNote)
    expect([ev.graphicalNotes[0], ev.graphicalNotes[1]]).toContain(first.graphicalNote)
    expect([ev.graphicalNotes[0], ev.graphicalNotes[1]]).toContain(second.graphicalNote)
  })

  it('a missed note carries its graphicalNote for coloring red', () => {
    const ev = event(1.0, [60])
    const matcher = new NoteMatcher([ev])
    const missed = matcher.sweepMissed(2.0)
    expect(missed[0].graphicalNote).toBe(ev.graphicalNotes[0])
  })

  it('an extra (wrong) note has no graphicalNote — nothing on the score to color', () => {
    const matcher = new NoteMatcher([event(1.0, [60])])
    const result = matcher.noteOn(61, 1.0)
    expect(result.graphicalNote).toBeUndefined()
  })

  it('carries the played velocity and expected hand onto a matched result', () => {
    const matcher = new NoteMatcher([event(1.0, [60], ['left'])])
    const result = matcher.noteOn(60, 1.0, 100)
    expect(result.velocity).toBe(100)
    expect(result.hand).toBe('left')
  })

  it('carries the played velocity onto an extra (wrong) note but no hand', () => {
    const matcher = new NoteMatcher([event(1.0, [60], ['left'])])
    const result = matcher.noteOn(61, 1.0, 45)
    expect(result.velocity).toBe(45)
    expect(result.hand).toBeUndefined()
  })

  it('carries the expected hand onto a missed note, with no velocity (never played)', () => {
    const matcher = new NoteMatcher([event(1.0, [60], ['right'])])
    const missed = matcher.sweepMissed(2.0)
    expect(missed[0].hand).toBe('right')
    expect(missed[0].velocity).toBeUndefined()
  })

  it('attributes each hand of a doubled unison pitch to the correct hand, not just in push order', () => {
    // Same pitch in both hands at once (e.g. an octave-doubled unison) — the
    // multiset must keep hand tags aligned with their own graphical note, not
    // just hand out whichever pitch match happens to be popped first.
    const matcher = new NoteMatcher([event(1.0, [60, 60], ['left', 'right'])])
    const first = matcher.noteOn(60, 1.0, 90)
    const second = matcher.noteOn(60, 1.0, 60)
    const hands = [first.hand, second.hand].sort()
    expect(hands).toEqual(['left', 'right'])
  })

  it('a repeated pitch at closely-spaced onsets (dense tuplets) still matches the nearer onset, not an adjacent one', () => {
    // Two same-pitch onsets 150ms apart — tight enough to occur in a fast
    // tuplet passage. Each play should attach to whichever onset it's
    // actually closest to in time, not just whichever is still open.
    const matcher = new NoteMatcher([event(1.0, [60]), event(1.15, [60])])
    const first = matcher.noteOn(60, 1.02) // closer to the first onset (20ms) than the second (130ms)
    expect(first.expectedOnsetSec).toBe(1.0)
    const second = matcher.noteOn(60, 1.13) // closer to the second onset (20ms) than the first (130ms)
    expect(second.expectedOnsetSec).toBeCloseTo(1.15)
    const { aggregate } = matcher.finalize()
    expect(aggregate).toMatchObject({ expected: 2, correct: 2, missed: 0, extra: 0 })
  })
})

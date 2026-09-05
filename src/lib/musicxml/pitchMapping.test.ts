import { describe, expect, it } from 'vitest'
import { halfToneToMidi } from './pitchMapping'

describe('halfToneToMidi', () => {
  it('maps middle C (OSMD halfTone 48) to MIDI 60', () => {
    expect(halfToneToMidi(48)).toBe(60)
  })

  it('maps A4 (OSMD halfTone 57) to MIDI 69', () => {
    expect(halfToneToMidi(57)).toBe(69)
  })

  it('matches the real halfTone OSMD produces for a written C3 (verified against the Clementi fixture)', () => {
    expect(halfToneToMidi(36)).toBe(48)
  })
})

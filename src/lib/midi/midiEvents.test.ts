import { describe, expect, it } from 'vitest'
import { parseMidiMessage } from './midiEvents'

describe('parseMidiMessage', () => {
  it('parses a Note On with positive velocity as noteOn', () => {
    const result = parseMidiMessage(new Uint8Array([0x90, 60, 100]), 123)
    expect(result).toEqual({ type: 'noteOn', note: 60, velocity: 100, timeStampMs: 123 })
  })

  it('parses a Note On with velocity 0 as noteOff (common keyboard convention)', () => {
    const result = parseMidiMessage(new Uint8Array([0x90, 60, 0]), 123)
    expect(result).toEqual({ type: 'noteOff', note: 60, velocity: 0, timeStampMs: 123 })
  })

  it('parses an explicit Note Off (0x80) as noteOff regardless of velocity', () => {
    const result = parseMidiMessage(new Uint8Array([0x80, 60, 64]), 123)
    expect(result).toEqual({ type: 'noteOff', note: 60, velocity: 64, timeStampMs: 123 })
  })

  it('ignores the MIDI channel nibble (status byte low bits)', () => {
    // Note On, channel 5 (0x94) instead of channel 0 (0x90)
    const result = parseMidiMessage(new Uint8Array([0x94, 60, 100]), 123)
    expect(result?.type).toBe('noteOn')
  })

  it('returns undefined for non-note messages (e.g. control change / sustain pedal)', () => {
    const result = parseMidiMessage(new Uint8Array([0xb0, 64, 127]), 123)
    expect(result).toBeUndefined()
  })

  it('returns undefined for pitch bend messages', () => {
    const result = parseMidiMessage(new Uint8Array([0xe0, 0, 64]), 123)
    expect(result).toBeUndefined()
  })
})

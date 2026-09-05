import { describe, expect, it } from 'vitest'
import { keyToNote, midiNoteToName } from './virtualKeyboard'

describe('keyToNote', () => {
  it('maps the home-row white keys to C4..E5', () => {
    expect(keyToNote('a')).toBe(60)
    expect(keyToNote('d')).toBe(64)
    expect(keyToNote('j')).toBe(71)
    expect(keyToNote("'")).toBe(77)
  })

  it('maps the top-row black keys', () => {
    expect(keyToNote('w')).toBe(61)
    expect(keyToNote('t')).toBe(66)
    expect(keyToNote('o')).toBe(73)
  })

  it('is case-insensitive', () => {
    expect(keyToNote('A')).toBe(60)
    expect(keyToNote('W')).toBe(61)
  })

  it('returns undefined for unmapped keys', () => {
    expect(keyToNote('z')).toBeUndefined()
    expect(keyToNote('Enter')).toBeUndefined()
  })
})

describe('midiNoteToName', () => {
  it('names notes with octave (C4 = 60)', () => {
    expect(midiNoteToName(60)).toBe('C4')
    expect(midiNoteToName(61)).toBe('C#4')
    expect(midiNoteToName(72)).toBe('C5')
  })
})
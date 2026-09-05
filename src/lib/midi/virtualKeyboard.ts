export const KEYBOARD_VELOCITY = 80

/**
 * Physical computer key (lowercase) → MIDI note number, laid out like a
 * piano: bottom row `A S D F G H J K L ; '` is the white keys C4–E5, top
 * row `W E T Y U O P` the black keys in between. Handy for testing without
 * a real keyboard plugged in.
 */
export const KEY_TO_NOTE: Record<string, number> = {
  a: 60, // C4
  w: 61, // C#4
  s: 62, // D4
  e: 63, // D#4
  d: 64, // E4
  f: 65, // F4
  t: 66, // F#4
  g: 67, // G4
  y: 68, // G#4
  h: 69, // A4
  u: 70, // A#4
  j: 71, // B4
  k: 72, // C5
  o: 73, // C#5
  l: 74, // D5
  p: 75, // D#5
  ';': 76, // E5
  "'": 77, // F5
}

export function keyToNote(key: string): number | undefined {
  return KEY_TO_NOTE[key.toLowerCase()]
}

export function midiNoteToName(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`
}
export type MidiNoteEvent =
  | { type: 'noteOn'; note: number; velocity: number; timeStampMs: number }
  | { type: 'noteOff'; note: number; velocity: number; timeStampMs: number }

/**
 * Parses a raw MIDI message. Many keyboards send Note-On with velocity 0
 * instead of a real Note-Off (a long-standing MIDI convention) — both forms
 * are normalized to `noteOff` here so callers don't need to know about it.
 * Returns undefined for any message that isn't a note on/off (e.g. CC,
 * pitch bend, sustain pedal — all out of scope for v1).
 */
export function parseMidiMessage(data: Uint8Array, timeStampMs: number): MidiNoteEvent | undefined {
  const status = data[0] & 0xf0
  const note = data[1]
  const velocity = data[2] ?? 0

  if (status === 0x90 && velocity > 0) {
    return { type: 'noteOn', note, velocity, timeStampMs }
  }
  if (status === 0x80 || status === 0x90) {
    return { type: 'noteOff', note, velocity, timeStampMs }
  }
  return undefined
}

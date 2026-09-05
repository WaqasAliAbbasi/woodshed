/**
 * OSMD's `note.halfTone` (see Pitch.ts in OSMD 2.1.2) is built from two
 * steps that partially cancel out:
 *   1. VoiceGenerator.addSingleNote subtracts Pitch.OctaveXmlDifference (3)
 *      from the raw MusicXML <octave> value before constructing Pitch:
 *        adjustedOctave = xmlOctave - 3
 *   2. Pitch's constructor then adds the same constant back in:
 *        halfTone = fundamentalNote + (adjustedOctave + 3) * 12 + accidentalHalfTones
 *                 = fundamentalNote + xmlOctave * 12 + accidentalHalfTones
 * where `fundamentalNote` is 0/2/4/5/7/9/11 for C/D/E/F/G/A/B.
 *
 * Standard MIDI uses middle C (C4) = 60. For C4: halfTone = 0 + 4*12 = 48,
 * so the offset is +12 — confirmed both algebraically and empirically
 * against a real file (OSMD's own Clementi Sonatina fixture): a written C3
 * left-hand note produces halfTone 36, and 36+12=48=C3's correct MIDI
 * number. (An earlier pass at this derivation missed step 1 above — a
 * case-sensitive source grep for "octave" silently skipped the
 * capital-O "Octave" in `Pitch.OctaveXmlDifference` — and concluded -24;
 * that value is wrong, verify against real output before trusting either.)
 */
const HALFTONE_TO_MIDI_OFFSET = 12;

export function halfToneToMidi(halfTone: number): number {
  return halfTone + HALFTONE_TO_MIDI_OFFSET;
}

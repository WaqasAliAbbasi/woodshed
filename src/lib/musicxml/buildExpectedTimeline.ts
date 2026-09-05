import type { Note, OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { halfToneToMidi } from './pitchMapping'
import type { ExpectedChordEvent, MeasureRange } from './types'

/** A note tied *from* a previous note is a continuation, not a new attack — skip it. */
function isTiedContinuation(note: Note): boolean {
  const tie = note.NoteTie
  return tie !== undefined && tie.StartNote !== note
}

/**
 * Reads the actual time signature's numerator (beats per measure) at
 * `measureNumber`, falling back to 4 if unavailable. Assumes a quarter-note
 * beat (correct for simple meters like 2/4, 3/4, 4/4; compound meters like
 * 6/8 would want a dotted-quarter beat, which this doesn't attempt).
 */
export function getBeatsPerMeasure(osmd: OpenSheetMusicDisplay, measureNumber: number): number {
  const sourceMeasure = osmd.Sheet.SourceMeasures[measureNumber - 1]
  const numerator = sourceMeasure?.ActiveTimeSignature?.Numerator
  return numerator && numerator > 0 ? numerator : 4
}

/**
 * Repositions OSMD's single shared cursor to the first position at or after
 * `measureNumber`, walking forward from the very start each time (cheap for
 * short beginner pieces). Idempotent and safe to call repeatedly — this is
 * the only way to reposition the cursor, since it doesn't support seeking
 * directly to an arbitrary measure.
 */
export function advanceCursorToMeasure(osmd: OpenSheetMusicDisplay, measureNumber: number): void {
  const cursor = osmd.cursor
  cursor.reset()
  while (!cursor.Iterator.EndReached && cursor.Iterator.CurrentMeasure.MeasureNumber < measureNumber) {
    cursor.next()
  }
  cursor.update()
}

/**
 * Walks the score's cursor across `range` and produces the sequence of
 * expected chord onsets at `tempoBpm`, relative to the start of the range
 * (first event is at onsetSec = 0).
 *
 * Each cursor stop (`cursor.next()`) already corresponds to one distinct
 * vertical timestamp — OSMD's `NotesUnderCursor()` returns every note
 * sounding at that instant across all staves/voices, so chord grouping is
 * automatic and doesn't need to be done by hand.
 *
 * Mutates the shared `osmd.cursor` position as a side effect of the walk
 * (leaving it wherever iteration stopped) — callers that need the cursor
 * for visual playback afterward must reposition it themselves, e.g. via
 * `advanceCursorToMeasure`.
 */
export function buildExpectedTimeline(
  osmd: OpenSheetMusicDisplay,
  range: MeasureRange,
  tempoBpm: number,
): ExpectedChordEvent[] {
  advanceCursorToMeasure(osmd, range.startMeasure)
  const cursor = osmd.cursor

  const events: ExpectedChordEvent[] = []
  let rangeStartRealValue: number | undefined

  while (!cursor.Iterator.EndReached) {
    const measureNumber = cursor.Iterator.CurrentMeasure.MeasureNumber
    if (measureNumber > range.endMeasure) break

    // NotesUnderCursor() and GNotesUnderCursor() both iterate the exact same
    // VoicesUnderCursor() list in the same order (see OSMD's Cursor.ts), so
    // zip them into pairs *before* filtering to keep midiNumbers/
    // graphicalNotes index-aligned afterward.
    const logicalNotes = cursor.NotesUnderCursor()
    const graphicalNotes = cursor.GNotesUnderCursor()
    const pairs = logicalNotes
      .map((note, i) => ({ note, gNote: graphicalNotes[i] }))
      .filter(({ note }) => !note.isRest() && !isTiedContinuation(note))

    if (pairs.length > 0) {
      const realValue = cursor.Iterator.currentTimeStamp.RealValue
      rangeStartRealValue ??= realValue

      const beatsPerSecond = tempoBpm / 60
      const onsetSec = ((realValue - rangeStartRealValue) * 4) / beatsPerSecond
      const durationSec = (Math.max(...pairs.map(({ note }) => note.Length.RealValue)) * 4) / beatsPerSecond

      events.push({
        onsetSec,
        durationSec,
        midiNumbers: pairs.map(({ note }) => halfToneToMidi(note.halfTone)),
        graphicalNotes: pairs.map(({ gNote }) => gNote),
        measureNumber,
      })
    }

    cursor.next()
  }

  return events
}

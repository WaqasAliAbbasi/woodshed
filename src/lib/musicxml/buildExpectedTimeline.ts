import type { Note, OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { halfToneToMidi } from './pitchMapping'
import type { ExpectedChordEvent, MeasureRange } from './types'

/** A note tied *from* a previous note is a continuation, not a new attack — skip it. */
function isTiedContinuation(note: Note): boolean {
  const tie = note.NoteTie
  return tie !== undefined && tie.StartNote !== note
}

/** Which hand(s) to include when building a timeline — see `buildExpectedTimeline`'s `handFilter` param. */
export type HandFilter = 'both' | 'right' | 'left'

/**
 * Classifies a note's hand by its staff position within the whole sheet
 * (`idInMusicSheet`, a global top-to-bottom index): staff 0 is the topmost
 * staff, which on a piano grand staff is always the right hand regardless
 * of whether the piece encodes hands as two separate `<part>`s or one part
 * with two `<staff>`s — both real-world MusicXML shapes land notes on the
 * same global staff ordering. Anything below staff 0 counts as the left
 * hand; pieces with more than two staves aren't a case this app expects.
 */
/** Which hand a note belongs to, by the same staff-position rule matchesHand uses. */
function noteHand(note: Note): 'left' | 'right' {
  return note.ParentStaff.idInMusicSheet === 0 ? 'right' : 'left'
}

function matchesHand(note: Note, handFilter: HandFilter): boolean {
  if (handFilter === 'both') return true
  return noteHand(note) === handFilter
}

/** Number of staves in the piece — used to decide whether hand-isolated practice is even offered (nothing to isolate with only one staff). */
export function getStaffCount(osmd: OpenSheetMusicDisplay): number {
  return osmd.Sheet.getCompleteNumberOfStaves()
}

/**
 * Looks up a measure by its `MeasureNumber` — deliberately *not*
 * `SourceMeasures[measureNumber - 1]`. That positional shortcut only holds
 * for a piece whose first measure is number 1: a piece that opens with a
 * pickup/anacrusis measure gets renumbered by OSMD starting at *0* (an
 * "implicit" measure, auto-detected from its notated duration being shorter
 * than the meter — see `getActualBeatsInMeasure`), which shifts every
 * following `MeasureNumber` down by one relative to its array index. Direct
 * lookup by number is correct regardless of which numbering the piece uses.
 */
function getSourceMeasure(osmd: OpenSheetMusicDisplay, measureNumber: number) {
  return osmd.Sheet.SourceMeasures.find((m) => m.MeasureNumber === measureNumber)
}

/**
 * Returns the number of quarter-note-equivalent beats per measure at
 * `measureNumber`, falling back to 4 if unavailable. The metronome and
 * `tempoBpm` throughout this app are always quarter-note-based (see
 * `Metronome.secondsPerBeat` and this file's own onsetSec math), so a raw
 * time-signature numerator is only correct when the beat unit is a quarter
 * note (2/4, 3/4, 4/4). For other beat units — e.g. 6/8, where the numerator
 * counts eighth notes — the count is rescaled by beatType/4 (6/8 -> 3) so
 * the count-in length and beat indicator match the measure's actual
 * duration instead of running proportionally too long or short.
 */
export function getBeatsPerMeasure(osmd: OpenSheetMusicDisplay, measureNumber: number): number {
  const sourceMeasure = getSourceMeasure(osmd, measureNumber)
  const timeSignature = sourceMeasure?.ActiveTimeSignature
  if (!timeSignature) return 4
  const quarterNoteBeats = Math.round(timeSignature.RealValue * 4)
  return quarterNoteBeats > 0 ? quarterNoteBeats : 4
}

/**
 * Actual notated beats in `measureNumber`, in quarter-note-equivalent
 * units — derived from the measure's real duration (`SourceMeasure.Duration`),
 * which is shorter than the nominal meter for a pickup/anacrusis measure (or
 * any other incomplete measure, e.g. a short final measure). Falls back to
 * the nominal meter count if duration info is unavailable.
 */
function getActualBeatsInMeasure(osmd: OpenSheetMusicDisplay, measureNumber: number): number {
  const sourceMeasure = getSourceMeasure(osmd, measureNumber)
  const duration = sourceMeasure?.Duration
  if (!duration) return getBeatsPerMeasure(osmd, measureNumber)
  const quarterNoteBeats = Math.round(duration.RealValue * 4)
  return quarterNoteBeats > 0 ? quarterNoteBeats : getBeatsPerMeasure(osmd, measureNumber)
}

/**
 * Number of metronome beats to click before a practice attempt begins.
 *
 * A full measure gets a full lead-in bar of clicks (the standard
 * "1-2-3-4, [play]" count-in: `nominalBeats * countInMeasures`, unchanged
 * from before this existed). A *short* start measure — most commonly a
 * pickup/anacrusis, like the 1-beat pickup landing on beat 4 of a 4/4 bar in
 * "Calypso Carnival" (Alfred Book 2) — instead clicks through just the
 * "missing" beats at the top of its own conceptual bar (here, 3 clicks,
 * "1-2-3"), so the pickup coincides with where the click would land, the
 * same way a full measure's beat 1 coincides with the click right after its
 * own lead-in bar. `beatsPerMeasure` (used for the beat-indicator dots and
 * downbeat accent) intentionally stays at the nominal count either way —
 * only the count-in *length* changes.
 */
export function getCountInBeats(osmd: OpenSheetMusicDisplay, measureNumber: number, countInMeasures: number): number {
  const nominalBeats = getBeatsPerMeasure(osmd, measureNumber)
  const actualBeats = getActualBeatsInMeasure(osmd, measureNumber)
  if (actualBeats < nominalBeats) {
    return nominalBeats - actualBeats + nominalBeats * (countInMeasures - 1)
  }
  return nominalBeats * countInMeasures
}

/** Keep in sync with TempoControl's NumberField min/max. */
const MIN_TEMPO_BPM = 20
const MAX_TEMPO_BPM = 240
const FALLBACK_TEMPO_BPM = 80

/**
 * Reads the piece's own starting tempo (from a MusicXML `<sound tempo>` /
 * `<metronome>` marking, via OSMD's own parsing) so a practice session
 * starts at a tempo appropriate to the piece — a waltz and a march no
 * longer both default to the same generic value. Falls back to
 * FALLBACK_TEMPO_BPM when the piece has no tempo marking, clamped to the
 * practice tempo control's own range if the marking falls outside it.
 */
export function getDefaultTempoBpm(osmd: OpenSheetMusicDisplay): number {
  const sheet = osmd.Sheet
  if (!sheet.HasBPMInfo) return FALLBACK_TEMPO_BPM
  const bpm = Math.round(sheet.DefaultStartTempoInBpm)
  if (!Number.isFinite(bpm) || bpm <= 0) return FALLBACK_TEMPO_BPM
  return Math.min(MAX_TEMPO_BPM, Math.max(MIN_TEMPO_BPM, bpm))
}

/**
 * Standard mechanical-metronome dial markings (the Maelzel scale). Used to
 * round suggested slow-practice tempos to numbers a student would actually
 * dial in, instead of arbitrary fractions like "53 BPM".
 */
const METRONOME_DIAL_BPM = [
  40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 63, 66, 69, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120,
  126, 132, 138, 144, 152, 160, 168, 176, 184, 192, 200, 208,
]

function nearestDialBpm(bpm: number): number {
  return METRONOME_DIAL_BPM.reduce((closest, candidate) =>
    Math.abs(candidate - bpm) < Math.abs(closest - bpm) ? candidate : closest,
  )
}

/**
 * Suggests slow-practice tempos at roughly 1/3 and 2/3 of `targetBpm`,
 * rounded to standard metronome dial markings, plus the target itself as
 * the "full speed" preset (kept exact, since that one comes straight from
 * the score rather than being an invented step). Presets that collapse
 * together — e.g. a target already at or below the dial's slowest marking —
 * are deduplicated, so a very slow piece may yield fewer than three.
 */
export function getTempoPresets(targetBpm: number): number[] {
  const clamp = (bpm: number) => Math.min(MAX_TEMPO_BPM, Math.max(MIN_TEMPO_BPM, bpm))
  const presets = [clamp(nearestDialBpm(targetBpm / 3)), clamp(nearestDialBpm((targetBpm * 2) / 3)), clamp(targetBpm)]
  return Array.from(new Set(presets)).sort((a, b) => a - b)
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
 *
 * `handFilter` (default `'both'`) restricts the timeline to one hand's
 * notes for hands-separate practice — see `matchesHand`. A chord event is
 * only emitted if at least one note survives the filter, and `onsetSec 0`
 * always lands on the first surviving note, so isolating a hand doesn't
 * leave a silent gap at the start of the range.
 */
export function buildExpectedTimeline(
  osmd: OpenSheetMusicDisplay,
  range: MeasureRange,
  tempoBpm: number,
  handFilter: HandFilter = 'both',
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
      .filter(({ note }) => !note.isRest() && !isTiedContinuation(note) && matchesHand(note, handFilter))

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
        hands: pairs.map(({ note }) => noteHand(note)),
        measureNumber,
      })
    }

    cursor.next()
  }

  return events
}

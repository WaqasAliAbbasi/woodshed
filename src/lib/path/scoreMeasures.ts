/**
 * A lightweight, OSMD-free reading of a MusicXML score: one entry per
 * measure, in order, with just what the learning path needs — a content
 * signature (to spot repeated material, see `findRepeats`) and the phrase
 * evidence `chunkPiece` snaps chunk boundaries to.
 *
 * Deliberately not built on OpenSheetMusicDisplay: chunking has to run on
 * screens that never render the score (logging a lesson on a phone, a
 * folder import of a whole book), and OSMD needs a container and a full
 * render before its model is usable. `DOMParser` is all this needs.
 *
 * Measure numbers follow OSMD's, not the file's `number` attribute, because
 * every section and attempt range in the app is in OSMD's numbering (see
 * buildExpectedTimeline's `getSourceMeasure`): a first measure shorter than
 * its time signature is a pickup numbered 0, otherwise numbering starts at
 * 1, and it runs sequentially from there.
 */

export interface ScoreMeasure {
  /** OSMD-style measure number — see the module doc comment. */
  number: number
  /** True only for a leading pickup (anacrusis) measure. */
  pickup: boolean
  /**
   * Every note and rest in the measure, in both hands, as one canonical
   * string: two measures with equal signatures have the same pitches and
   * durations at the same positions on the same staves.
   */
  signature: string
  /** Number of pitched notes — a measure that's all rests has nothing to learn. */
  noteCount: number
  /** A slur ends somewhere in this measure. */
  slurEnds: boolean
  /** Either hand's last event in the measure is a rest. */
  restAtEnd: boolean
  fermata: boolean
  /** The barline after this measure is a double (or final) barline. */
  doubleBarline: boolean
}

export interface ParsedScore {
  measures: ScoreMeasure[]
  /** The score's own marked tempo in quarter-note BPM, if it has one. */
  markedTempoBpm?: number
}

interface NoteEvent {
  staff: string
  onset: number
  duration: number
  /** MIDI number, or undefined for a rest. */
  midi?: number
  grace: boolean
}

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function childText(parent: Element, tag: string): string | undefined {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tag) return child.textContent?.trim() ?? undefined
  }
  return undefined
}

function childElement(parent: Element, tag: string): Element | undefined {
  for (const child of Array.from(parent.children)) {
    if (child.tagName === tag) return child
  }
  return undefined
}

function pitchToMidi(pitch: Element): number | undefined {
  const step = childText(pitch, 'step')
  const octave = Number(childText(pitch, 'octave'))
  if (!step || !(step in STEP_SEMITONES) || !Number.isFinite(octave)) return undefined
  const alter = Number(childText(pitch, 'alter') ?? 0) || 0
  return (octave + 1) * 12 + STEP_SEMITONES[step] + Math.round(alter)
}

/** Rounds away float noise from divisions arithmetic (triplets etc.) so equal durations compare equal. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

const BEAT_UNIT_QUARTERS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
}

function readMarkedTempo(doc: Document): number | undefined {
  for (const sound of Array.from(doc.getElementsByTagName('sound'))) {
    const tempo = Number(sound.getAttribute('tempo'))
    if (Number.isFinite(tempo) && tempo > 0) return Math.round(tempo)
  }
  for (const metronome of Array.from(doc.getElementsByTagName('metronome'))) {
    const perMinute = Number(childText(metronome, 'per-minute'))
    const unit = BEAT_UNIT_QUARTERS[childText(metronome, 'beat-unit') ?? 'quarter']
    if (!Number.isFinite(perMinute) || perMinute <= 0 || unit === undefined) continue
    const dotted = childElement(metronome, 'beat-unit-dot') !== undefined
    return Math.round(perMinute * unit * (dotted ? 1.5 : 1))
  }
  return undefined
}

interface PartMeasure {
  events: NoteEvent[]
  /** Length actually filled, in quarter notes. */
  filled: number
  /** Nominal length from the active time signature, in quarter notes. */
  nominal: number
  slurEnds: boolean
  fermata: boolean
  doubleRight: boolean
  doubleLeft: boolean
}

function isDoubleBarline(barline: Element): boolean {
  const style = childText(barline, 'bar-style')
  return style === 'light-light' || style === 'light-heavy' || style === 'heavy-light' || style === 'heavy-heavy'
}

/** Walks one `<part>`'s measures, tracking divisions/time signature across them the way MusicXML carries them forward. */
function readPart(part: Element, partIndex: number): PartMeasure[] {
  let divisions = 1
  let nominal = 4
  const result: PartMeasure[] = []

  for (const measure of Array.from(part.children).filter((c) => c.tagName === 'measure')) {
    const events: NoteEvent[] = []
    let cursor = 0
    let maxCursor = 0
    let lastOnset = 0
    let slurEnds = false
    let fermata = false
    let doubleRight = false
    let doubleLeft = false

    for (const child of Array.from(measure.children)) {
      switch (child.tagName) {
        case 'attributes': {
          const div = Number(childText(child, 'divisions'))
          if (Number.isFinite(div) && div > 0) divisions = div
          const time = childElement(child, 'time')
          if (time) {
            const beats = Number(childText(time, 'beats'))
            const beatType = Number(childText(time, 'beat-type'))
            if (Number.isFinite(beats) && Number.isFinite(beatType) && beatType > 0) nominal = (beats * 4) / beatType
          }
          break
        }
        case 'backup':
          cursor -= Number(childText(child, 'duration') ?? 0) / divisions
          break
        case 'forward':
          cursor += Number(childText(child, 'duration') ?? 0) / divisions
          maxCursor = Math.max(maxCursor, cursor)
          break
        case 'barline': {
          if (isDoubleBarline(child)) {
            if (child.getAttribute('location') === 'left') doubleLeft = true
            else doubleRight = true
          }
          if (childElement(child, 'fermata')) fermata = true
          break
        }
        case 'note': {
          const grace = childElement(child, 'grace') !== undefined
          const isChord = childElement(child, 'chord') !== undefined
          const duration = grace ? 0 : Number(childText(child, 'duration') ?? 0) / divisions
          const onset = isChord ? lastOnset : cursor
          const pitch = childElement(child, 'pitch')
          const unpitched = childElement(child, 'unpitched')
          const notations = childElement(child, 'notations')
          if (notations) {
            for (const n of Array.from(notations.children)) {
              if (n.tagName === 'slur' && n.getAttribute('type') === 'stop') slurEnds = true
              if (n.tagName === 'fermata') fermata = true
            }
          }
          // A note tied from the previous one is a held continuation, not a new
          // attack — but it still occupies the bar, so it stays in the signature.
          events.push({
            staff: `${partIndex}:${childText(child, 'staff') ?? '1'}`,
            onset: round(onset),
            duration: round(duration),
            midi: pitch ? pitchToMidi(pitch) : unpitched ? -1 : undefined,
            grace,
          })
          if (!isChord) {
            lastOnset = cursor
            cursor += duration
            maxCursor = Math.max(maxCursor, cursor)
          }
          break
        }
      }
    }
    result.push({ events, filled: round(maxCursor), nominal: round(nominal), slurEnds, fermata, doubleRight, doubleLeft })
  }
  return result
}

function signatureOf(events: NoteEvent[]): string {
  return events
    .map((e) => `${e.staff}@${e.onset}:${e.midi ?? 'r'}/${e.duration}${e.grace ? 'g' : ''}`)
    .sort()
    .join(' ')
}

/** Either hand's final sounding event is a rest — no pitched note in that staff is still sounding when the rest starts. */
function hasRestAtEnd(events: NoteEvent[], length: number): boolean {
  const staves = new Set(events.map((e) => e.staff))
  for (const staff of staves) {
    const inStaff = events.filter((e) => e.staff === staff && !e.grace)
    const endingRests = inStaff.filter((e) => e.midi === undefined && round(e.onset + e.duration) >= length)
    for (const rest of endingRests) {
      const covered = inStaff.some((e) => e.midi !== undefined && e.onset + e.duration > rest.onset + 1e-6)
      if (!covered) return true
    }
  }
  return false
}

export function parseScore(musicXml: string): ParsedScore {
  const doc = new DOMParser().parseFromString(musicXml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('Could not read this MusicXML file.')
  const parts = Array.from(doc.getElementsByTagName('part')).filter((p) => p.parentElement?.tagName === 'score-partwise')
  const partMeasures = parts.map((part, i) => readPart(part, i))
  const count = Math.max(0, ...partMeasures.map((m) => m.length))

  const merged: Omit<ScoreMeasure, 'number'>[] = []
  for (let i = 0; i < count; i++) {
    const slices = partMeasures.map((pm) => pm[i]).filter((m): m is PartMeasure => m !== undefined)
    const events = slices.flatMap((s) => s.events)
    const filled = Math.max(...slices.map((s) => s.filled))
    const nominal = Math.max(...slices.map((s) => s.nominal))
    const nextSlices = partMeasures.map((pm) => pm[i + 1]).filter((m): m is PartMeasure => m !== undefined)
    merged.push({
      pickup: i === 0 && filled > 0 && filled < nominal - 1e-6,
      signature: signatureOf(events),
      noteCount: events.filter((e) => e.midi !== undefined && !e.grace).length,
      slurEnds: slices.some((s) => s.slurEnds),
      restAtEnd: hasRestAtEnd(events, filled),
      fermata: slices.some((s) => s.fermata),
      doubleBarline: slices.some((s) => s.doubleRight) || nextSlices.some((s) => s.doubleLeft),
    })
  }

  const firstNumber = merged[0]?.pickup ? 0 : 1
  return {
    measures: merged.map((m, i) => ({ ...m, number: firstNumber + i })),
    markedTempoBpm: readMarkedTempo(doc),
  }
}

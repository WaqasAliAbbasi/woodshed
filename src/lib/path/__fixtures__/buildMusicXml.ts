/**
 * Builds small, hand-written MusicXML for the path tests — the user's own
 * scores are copyrighted and never committed (see docs/learning-path.md).
 *
 * A measure is a list of notes per staff; a note is `"C4:4"` (pitch and
 * duration in quarter notes) or `"r:2"` for a rest. Extras mark phrase
 * evidence on the measure.
 */
export interface FixtureMeasure {
  rh: string[]
  lh?: string[]
  slurEnd?: boolean
  fermata?: boolean
  doubleBarline?: boolean
}

const DIVISIONS = 4

function noteXml(spec: string, staff: number, voice: number, extra = ''): string {
  const [pitch, quarters] = spec.split(':')
  const duration = Math.round(Number(quarters) * DIVISIONS)
  const body =
    pitch === 'r'
      ? '<rest/>'
      : `<pitch><step>${pitch[0]}</step>${pitch[1] === '#' ? '<alter>1</alter>' : ''}<octave>${pitch[pitch.length - 1]}</octave></pitch>`
  return `<note>${body}<duration>${duration}</duration><voice>${voice}</voice><staff>${staff}</staff>${extra}</note>`
}

function staffXml(notes: string[], staff: number, measure: FixtureMeasure): string {
  return notes
    .map((n, i) => {
      const last = i === notes.length - 1 && staff === 1
      const notations = [
        last && measure.slurEnd ? '<slur type="stop"/>' : '',
        last && measure.fermata ? '<fermata/>' : '',
      ].join('')
      return noteXml(n, staff, staff, notations ? `<notations>${notations}</notations>` : '')
    })
    .join('')
}

function quarters(notes: string[]): number {
  return notes.reduce((sum, n) => sum + Number(n.split(':')[1]), 0)
}

export function buildMusicXml(measures: FixtureMeasure[], options: { beats?: number; tempo?: number } = {}): string {
  const beats = options.beats ?? 4
  const body = measures
    .map((m, i) => {
      const attributes =
        i === 0
          ? `<attributes><divisions>${DIVISIONS}</divisions><time><beats>${beats}</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>${
              options.tempo ? `<sound tempo="${options.tempo}"/>` : ''
            }`
          : ''
      const rh = staffXml(m.rh, 1, m)
      const lh = m.lh ? `<backup><duration>${quarters(m.rh) * DIVISIONS}</duration></backup>${staffXml(m.lh, 2, m)}` : ''
      const barline = m.doubleBarline ? '<barline location="right"><bar-style>light-light</bar-style></barline>' : ''
      return `<measure number="${i + 1}">${attributes}${rh}${lh}${barline}</measure>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">${body}</part></score-partwise>`
}

/** A distinct one-bar melody for bar `n`, so no two generated bars repeat unless a test says so. */
export function uniqueBar(n: number): FixtureMeasure {
  const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
  const a = steps[n % 7]
  const b = steps[Math.floor(n / 7) % 7]
  const octave = 3 + (Math.floor(n / 49) % 3)
  return { rh: [`${a}5:2`, `${b}${octave + 1}:2`], lh: [`${a}3:4`] }
}

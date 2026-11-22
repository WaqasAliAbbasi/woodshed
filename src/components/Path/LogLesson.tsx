import { useState } from 'react'
import { createLesson, ensureChunks, type PathOverview } from '../../lib/db/pathRepo'
import { getPiece } from '../../lib/db/piecesRepo'
import { lastLessonDate } from '../../lib/path/deriveState'
import type { LessonOutcome } from '../../lib/path/types'
import { navigate } from '../../lib/router'
import { collectionLabel } from './links'
import { usePathData } from './usePathData'
import './path.css'

const OUTCOMES: { value: LessonOutcome; label: string }[] = [
  { value: 'finished', label: 'Finished' },
  { value: 'continue', label: 'Keep going' },
  { value: 'new', label: 'New' },
]

const EFFECT: Record<LessonOutcome, string> = {
  finished: 'Marked done: your teacher has the last word.',
  continue: '',
  new: 'Gets split into chunks and joins the plan from tomorrow.',
}

interface Row {
  pieceId: string
  outcome: LessonOutcome
  focus: string
}

function toDateInput(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The pieces the latest lessons left in play — prefilled, since a lesson usually revisits them. */
function initialRows(overview: PathOverview): Row[] {
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const lesson of overview.lessons) {
    for (const p of lesson.pieces) {
      if (seen.has(p.pieceId)) continue
      seen.add(p.pieceId)
      if (p.outcome !== 'finished' && overview.pieces.some((piece) => piece.id === p.pieceId)) {
        rows.push({ pieceId: p.pieceId, outcome: 'continue', focus: '' })
      }
    }
  }
  return rows
}

/** Log a lesson (`LogLesson` artboard): one entry, a row per piece covered. Phone-friendly. */
export function LogLesson() {
  const { overview, error } = usePathData()
  if (error) return <div className="path"><p className="p-error">{error}</p></div>
  if (!overview) return <div className="path"><p className="p-muted">Loading…</p></div>
  return <LessonForm overview={overview} />
}

function LessonForm({ overview }: { overview: PathOverview }) {
  const [date, setDate] = useState(() => toDateInput(lastLessonDate(Date.now(), overview.settings.lessonWeekday)))
  const [minutes, setMinutes] = useState(30)
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<Row[]>(() => initialRows(overview))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)

  const titles = new Map(overview.pieces.map((p) => [p.id, p.title]))
  const addable = overview.pieces.filter((p) => !rows.some((r) => r.pieceId === p.id)).sort((a, b) => a.title.localeCompare(b.title))
  const update = (pieceId: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.pieceId === pieceId ? { ...r, ...patch } : r)))

  const save = async () => {
    setSaving(true)
    setSaveError(undefined)
    try {
      const [y, m, d] = date.split('-').map(Number)
      const startedAt = new Date(y, m - 1, d, 12).getTime()
      await createLesson({
        startedAt,
        endedAt: startedAt + Math.max(0, minutes) * 60_000,
        note: note.trim() || undefined,
        pieces: rows.map((r) => ({ pieceId: r.pieceId, outcome: r.outcome, focus: r.outcome === 'continue' ? r.focus.trim() || undefined : undefined })),
      })
      // New pieces get their chunks now, so tomorrow's plan can show them.
      // A piece that fails to chunk here is chunked again when it's opened.
      await Promise.allSettled(
        rows
          .filter((r) => r.outcome === 'new')
          .map(async (r) => {
            const piece = await getPiece(r.pieceId)
            if (piece) await ensureChunks(piece)
          }),
      )
      navigate('/')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <div className="path" style={{ maxWidth: 760 }}>
      <div>
        <h1 className="p-h1">Log a lesson</h1>
        <p className="p-muted">What you covered sets next week's plan.</p>
      </div>
      <div className="p-row">
        <label className="p-field">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="p-field">
          Minutes
          <input type="number" min={0} max={240} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
      </div>

      <fieldset className="p-card" style={{ display: 'flex', flexDirection: 'column', gap: 18, margin: 0 }}>
        <legend className="p-h2" style={{ fontFamily: 'var(--font-display)', fontWeight: 600, padding: '0 6px' }}>
          Pieces you covered
        </legend>
        {rows.length === 0 && <p className="p-muted">Add each piece your teacher heard or set.</p>}
        {rows.map((row) => (
          <div key={row.pieceId} style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="p-step-title" style={{ justifyContent: 'space-between' }}>
              <span>
                <strong>{titles.get(row.pieceId)}</strong>{' '}
                {collectionLabel(row.pieceId, overview.collections) && (
                  <span className="p-tag">{collectionLabel(row.pieceId, overview.collections)}</span>
                )}
              </span>
              <button type="button" className="p-link" onClick={() => setRows((rs) => rs.filter((r) => r.pieceId !== row.pieceId))}>
                Remove
              </button>
            </div>
            <div className="p-outcomes" role="group" aria-label={`Outcome for ${titles.get(row.pieceId)}`}>
              {OUTCOMES.map((o) => (
                <button key={o.value} type="button" aria-pressed={row.outcome === o.value} onClick={() => update(row.pieceId, { outcome: o.value })}>
                  {o.label}
                </button>
              ))}
            </div>
            {row.outcome === 'continue' ? (
              <label className="p-field" style={{ fontWeight: 400, fontSize: 17 }}>
                Focus for this week
                <input type="text" value={row.focus} placeholder="e.g. m. 8 left hand" onChange={(e) => update(row.pieceId, { focus: e.target.value })} />
              </label>
            ) : (
              <p className="p-muted p-small">{EFFECT[row.outcome]}</p>
            )}
          </div>
        ))}
        {addable.length > 0 && (
          <label className="p-field" style={{ fontWeight: 400 }}>
            Add a piece
            <select
              value=""
              onChange={(e) => {
                const pieceId = e.target.value
                if (pieceId) setRows((rs) => [...rs, { pieceId, outcome: 'new', focus: '' }])
              }}
            >
              <option value="">Choose a piece…</option>
              {addable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <label className="p-field">
        Lesson note
        <textarea rows={3} value={note} placeholder="Anything else your teacher said" onChange={(e) => setNote(e.target.value)} />
      </label>

      {saveError && <p className="p-error">{saveError}</p>}
      <button type="button" className="p-btn p-btn-primary" disabled={saving || rows.length === 0} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save lesson'}
      </button>
    </div>
  )
}

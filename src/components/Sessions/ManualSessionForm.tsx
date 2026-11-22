import { useState, type FormEvent } from 'react'
import type { PieceSummary } from '../../lib/db/piecesRepo'

const MIN_MINUTES = 1
const MAX_MINUTES = 600

function todayInputValue(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function nowInputValue(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Logs practice Woodshed didn't witness — away from the keyboard, a piece
 * with no score uploaded, a lesson. Asks for a start time + a length in
 * minutes rather than a start/end pair: nobody remembers "I finished at
 * 4:52", they remember "about 40 minutes" — see docs/sessions-plan.md.
 */
export function ManualSessionForm({
  pieces,
  onSubmit,
  onCancel,
}: {
  pieces: PieceSummary[]
  onSubmit: (input: { startedAt: number; endedAt: number; label?: string; pieceId?: string; note?: string }) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState(todayInputValue())
  const [time, setTime] = useState(nowInputValue())
  const [minutes, setMinutes] = useState(30)
  const [label, setLabel] = useState('')
  const [pieceId, setPieceId] = useState('')
  const [note, setNote] = useState('')
  const [validationError, setValidationError] = useState<string | undefined>(undefined)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const startedAt = new Date(`${date}T${time}`).getTime()
    if (!Number.isFinite(startedAt)) {
      setValidationError('Enter a valid date and time.')
      return
    }
    if (!Number.isFinite(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
      setValidationError(`Minutes must be between ${MIN_MINUTES} and ${MAX_MINUTES}.`)
      return
    }
    onSubmit({
      startedAt,
      endedAt: startedAt + minutes * 60_000,
      label: label.trim() || undefined,
      pieceId: pieceId || undefined,
      note: note.trim() || undefined,
    })
  }

  return (
    <form className="s-log-form" onSubmit={handleSubmit}>
      <h2 className="p-h2">Log practice</h2>
      <div className="p-row">
        <label className="p-field">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="p-field">
          Start time
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
        <label className="p-field">
          Minutes
          <input
            type="number"
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            required
          />
        </label>
      </div>
      <div className="p-row">
        <label className="p-field">
          What was it?
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Scales, lesson, sight-reading…"
          />
        </label>
        <label className="p-field">
          Piece (optional)
          <select value={pieceId} onChange={(e) => setPieceId(e.target.value)}>
            <option value="">None</option>
            {pieces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="p-field">
        Note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="How did it go?" />
      </label>
      {validationError && <p className="p-error">{validationError}</p>}
      <div className="p-actions">
        <button type="button" className="p-btn p-btn-small" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="p-btn p-btn-small s-btn-pine">
          Log it
        </button>
      </div>
    </form>
  )
}

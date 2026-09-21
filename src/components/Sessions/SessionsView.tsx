import { useEffect, useState } from 'react'
import type { PieceSummary } from '../../lib/db/piecesRepo'
import { listPieces } from '../../lib/db/piecesRepo'
import { createManualSession, deleteSession, listSessions, updateSession } from '../../lib/db/sessionsRepo'
import type { PracticeSession } from '../../lib/db/db'
import { formatDuration } from '../../lib/pieceStats'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import { formatDayHeader, groupByPracticeDay } from './groupByPracticeDay'
import { ManualSessionForm } from './ManualSessionForm'

function formatTimeRange(startedAt: number, endedAt: number): string {
  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
  const start = new Date(startedAt).toLocaleTimeString(undefined, opts)
  const end = new Date(endedAt).toLocaleTimeString(undefined, opts)
  return `${start} – ${end}`
}

/** Click-to-edit note, styled like `App.tsx`'s `RenamableTitle` — draft-until-committed, Enter/blur saves, Escape cancels. Shown for both derived and manual sessions: adding a note in retrospect is the whole reason a derived session is a stored row at all (see docs/sessions-plan.md). */
function EditableNote({ session, onSaved }: { session: PracticeSession; onSaved: (updated: PracticeSession) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.note ?? '')
  const [saving, setSaving] = useState(false)

  const commit = async () => {
    const trimmed = draft.trim()
    if (trimmed === (session.note ?? '')) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const updated = await updateSession(session.id, { note: trimmed || null })
      onSaved(updated)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <textarea
        className="session-note-edit"
        autoFocus
        value={draft}
        disabled={saving}
        placeholder="What stood out about this session?"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(session.note ?? '')
            setEditing(false)
          }
          // Enter alone would block writing a multi-line note — Cmd/Ctrl+Enter commits instead.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            e.currentTarget.blur()
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className={`session-note${session.note ? '' : ' session-note-empty'}`}
      onClick={() => {
        setDraft(session.note ?? '')
        setEditing(true)
      }}
    >
      {session.note || 'Add a note'}
    </button>
  )
}

function SessionRow({
  session,
  pieceTitleById,
  onNoteSaved,
  onDeleteRequested,
}: {
  session: PracticeSession
  pieceTitleById: Map<string, string>
  onNoteSaved: (updated: PracticeSession) => void
  onDeleteRequested: (session: PracticeSession) => void
}) {
  const pieces = session.pieceIds.map((id) => pieceTitleById.get(id) ?? id)
  return (
    <li className="session-row">
      <div className="session-row-main">
        <span className="session-time">{formatTimeRange(session.startedAt, session.endedAt)}</span>
        <span className="session-duration">{formatDuration(session.endedAt - session.startedAt)}</span>
        {session.source === 'manual' ? (
          <span className="session-label">{session.label || 'Practice'}</span>
        ) : (
          <span className="session-label">
            {pieces.length > 0 ? pieces.join(', ') : 'Practice'}
            {session.attemptCount > 0 && (
              <span className="session-attempt-count">
                {' '}
                · {session.attemptCount} attempt{session.attemptCount === 1 ? '' : 's'}
              </span>
            )}
          </span>
        )}
        {session.source === 'manual' && (
          <button type="button" className="session-delete" aria-label="Delete logged session" onClick={() => onDeleteRequested(session)}>
            Delete
          </button>
        )}
      </div>
      <EditableNote session={session} onSaved={onNoteSaved} />
    </li>
  )
}

/**
 * Sessions view — derived (clustered from recorded attempts) and manual
 * (logged by hand, for practice Woodshed didn't witness) sessions in one
 * reverse-chronological list, grouped by the same 4am-boundary practice day
 * the streak uses. See docs/sessions-plan.md for why sessions are stored
 * rows rather than computed on read — it's what lets a note survive being
 * added after the fact.
 */
export function SessionsView() {
  const [sessions, setSessions] = useState<PracticeSession[] | undefined>(undefined)
  const [pieces, setPieces] = useState<PieceSummary[]>([])
  const [showManualForm, setShowManualForm] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PracticeSession | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = () =>
    Promise.all([listSessions(), listPieces()]).then(([loadedSessions, loadedPieces]) => {
      setSessions(loadedSessions)
      setPieces(loadedPieces)
    })

  useEffect(() => {
    void refresh()
  }, [])

  const pieceTitleById = new Map(pieces.map((p) => [p.id, p.title]))

  const handleNoteSaved = (updated: PracticeSession) => {
    setSessions((current) => current?.map((s) => (s.id === updated.id ? updated : s)))
  }

  const handleManualCreate = async (input: { startedAt: number; endedAt: number; label?: string; pieceId?: string; note?: string }) => {
    setError(undefined)
    try {
      await createManualSession(input)
      setShowManualForm(false)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDelete = async (session: PracticeSession) => {
    setPendingDelete(undefined)
    setError(undefined)
    try {
      await deleteSession(session.id)
      setSessions((current) => current?.filter((s) => s.id !== session.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const groups = groupByPracticeDay(sessions ?? [])

  return (
    <div className="sessions-view panel">
      <div className="sessions-view-header">
        <h2>Practice sessions</h2>
        <button type="button" className="link-back" onClick={() => setShowManualForm(true)}>
          + Log past practice
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {showManualForm && (
        <ManualSessionForm pieces={pieces} onCancel={() => setShowManualForm(false)} onSubmit={(input) => void handleManualCreate(input)} />
      )}

      {sessions === undefined ? null : sessions.length === 0 ? (
        <p className="history-empty">No practice sessions yet — they'll appear here as you practice, or log one by hand.</p>
      ) : (
        <div className="session-day-groups">
          {groups.map((group) => (
            <div key={group.dayKey} className="session-day-group">
              <h3 className="session-day-header">{formatDayHeader(group.dayKey)}</h3>
              <ul className="session-list">
                {group.sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    pieceTitleById={pieceTitleById}
                    onNoteSaved={handleNoteSaved}
                    onDeleteRequested={setPendingDelete}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          message="Delete this logged session? Its note goes with it."
          onConfirm={() => void handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(undefined)}
        />
      )}
    </div>
  )
}

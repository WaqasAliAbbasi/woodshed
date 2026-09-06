import { useEffect, useState } from 'react'
import { deleteAttempt, listAttemptsForPiece } from '../../lib/db/attemptsRepo'
import { listSectionsForPiece } from '../../lib/db/sectionsRepo'
import type { Attempt, Section } from '../../lib/db/db'
import { suggestNextStep } from '../../lib/coach/suggestNextStep'
import { summarizeSectionProgress } from '../../lib/coach/pieceProgress'

export function HistoryView({ pieceId, refreshKey }: { pieceId: string; refreshKey: number }) {
  const [loaded, setLoaded] = useState<
    { pieceId: string; attempts: Attempt[]; sectionById: Map<string, Section> } | undefined
  >(undefined)

  useEffect(() => {
    let cancelled = false
    Promise.all([listAttemptsForPiece(pieceId), listSectionsForPiece(pieceId)]).then(([attempts, sections]) => {
      if (cancelled) return
      setLoaded({
        pieceId,
        attempts: attempts.slice().sort((a, b) => b.timestamp - a.timestamp),
        sectionById: new Map(sections.map((s) => [s.id, s])),
      })
    })
    return () => {
      cancelled = true
    }
  }, [pieceId, refreshKey])

  const handleDelete = async (attempt: Attempt) => {
    if (!window.confirm(`Delete this attempt from ${new Date(attempt.timestamp).toLocaleString()}?`)) return
    await deleteAttempt(attempt.id)
    setLoaded((current) =>
      current && current.pieceId === pieceId
        ? { ...current, attempts: current.attempts.filter((a) => a.id !== attempt.id) }
        : current,
    )
  }

  // Show only attempts belonging to the current piece. Deriving this from
  // state instead of clearing it synchronously in an effect avoids a
  // cascading render and a flash of the previous piece's rows while the new
  // piece's attempts load.
  const attempts = loaded?.pieceId === pieceId ? loaded.attempts : []
  const sectionById = loaded?.pieceId === pieceId ? loaded.sectionById : undefined

  // Wait for data to load before suggesting anything — an empty-attempts
  // suggestion would otherwise flash "get started" for a piece that
  // actually has history, on every piece switch.
  if (!loaded || loaded.pieceId !== pieceId) return null

  const progress = summarizeSectionProgress(Array.from(sectionById!.values()), attempts)
  const suggestion = suggestNextStep(progress, attempts)

  return (
    <>
      <div className="coach-suggestion">
        {suggestion.sessionNote && <p className="coach-session-note">{suggestion.sessionNote}</p>}
        <p className="coach-headline">{suggestion.headline}</p>
        {suggestion.detail && <p className="coach-detail">{suggestion.detail}</p>}
        {suggestion.alsoQueued && suggestion.alsoQueued.length > 0 && (
          <p className="coach-queue">Also due: {suggestion.alsoQueued.join(', ')}</p>
        )}
      </div>

      {attempts.length === 0 ? (
        <p className="history-empty">No attempts yet for this piece.</p>
      ) : (
        <ul className="log-list">
          {attempts.map((attempt) => (
            <li key={attempt.id} className="log-row">
              <span className="log-when">{new Date(attempt.timestamp).toLocaleString()}</span>
              <span className="log-range">{sectionById?.get(attempt.sectionId)?.label ?? attempt.sectionId}</span>
              <span className="log-tempo">{attempt.tempoBpm} BPM</span>
              <span className="log-score">
                {Math.round(attempt.aggregate.pitchAccuracy * 100)} / {Math.round(attempt.aggregate.timingAccuracy * 100)}
              </span>
              {attempt.aborted && <span className="banner banner-warning log-aborted">Stopped early</span>}
              <button
                type="button"
                className="attempt-delete"
                aria-label={`Delete attempt from ${new Date(attempt.timestamp).toLocaleString()}`}
                onClick={() => void handleDelete(attempt)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

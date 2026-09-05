import { useEffect, useState } from 'react'
import { listAttemptsForPiece } from '../../lib/db/attemptsRepo'
import { listSectionsForPiece } from '../../lib/db/sectionsRepo'
import type { Attempt, Section } from '../../lib/db/db'

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

  // Show only attempts belonging to the current piece. Deriving this from
  // state instead of clearing it synchronously in an effect avoids a
  // cascading render and a flash of the previous piece's rows while the new
  // piece's attempts load.
  const attempts = loaded?.pieceId === pieceId ? loaded.attempts : []
  const sectionById = loaded?.pieceId === pieceId ? loaded.sectionById : undefined

  if (attempts.length === 0) {
    return <p className="history-empty">No attempts yet for this piece.</p>
  }

  return (
    <table className="history-table">
      <thead>
        <tr>
          <th>When</th>
          <th>Section</th>
          <th>Tempo</th>
          <th>Pitch</th>
          <th>Timing</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {attempts.map((attempt) => (
          <tr key={attempt.id}>
            <td>{new Date(attempt.timestamp).toLocaleString()}</td>
            <td>{sectionById?.get(attempt.sectionId)?.label ?? attempt.sectionId}</td>
            <td>{attempt.tempoBpm} BPM</td>
            <td>{Math.round(attempt.aggregate.pitchAccuracy * 100)}%</td>
            <td>{Math.round(attempt.aggregate.timingAccuracy * 100)}%</td>
            <td>{attempt.aborted ? 'stopped early' : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

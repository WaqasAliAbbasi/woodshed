import { useEffect, useState } from 'react'
import { summarizeSectionProgress, type SectionProgress } from '../../lib/coach/pieceProgress'
import { listAttemptsForPiece } from '../../lib/db/attemptsRepo'
import { listSectionsForPiece } from '../../lib/db/sectionsRepo'

const STATUS_LABEL: Record<SectionProgress['status'], string> = {
  struggling: 'Struggling',
  progressing: 'Progressing',
  ready: 'Ready',
}

function formatAccuracy(attempt: SectionProgress['latest']): string {
  return `${Math.round(attempt.aggregate.pitchAccuracy * 100)}% pitch / ${Math.round(attempt.aggregate.timingAccuracy * 100)}% timing`
}

/**
 * One row per practiced section, ranked struggling-first — the practice
 * priority queue that HistoryView's single coach suggestion doesn't cover
 * (that one only ever looks at the most-recently-attempted section, not the
 * whole piece). See `summarizeSectionProgress`.
 */
export function PieceProgress({ pieceId, refreshKey }: { pieceId: string; refreshKey: number }) {
  const [loaded, setLoaded] = useState<{ pieceId: string; summaries: SectionProgress[] } | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    Promise.all([listSectionsForPiece(pieceId), listAttemptsForPiece(pieceId)]).then(([sections, attempts]) => {
      if (cancelled) return
      setLoaded({ pieceId, summaries: summarizeSectionProgress(sections, attempts) })
    })
    return () => {
      cancelled = true
    }
  }, [pieceId, refreshKey])

  const summaries = loaded?.pieceId === pieceId ? loaded.summaries : []
  if (!loaded || loaded.pieceId !== pieceId) return null

  if (summaries.length === 0) {
    return <p className="history-empty">No sections practiced yet — take an attempt to start tracking progress.</p>
  }

  return (
    <table className="history-table">
      <thead>
        <tr>
          <th>Section</th>
          <th>Attempts</th>
          <th>Best</th>
          <th>Latest</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {summaries.map((summary) => (
          <tr key={summary.section.id}>
            <td>{summary.section.label}</td>
            <td>{summary.attemptCount}</td>
            <td>{formatAccuracy(summary.best)}</td>
            <td>{formatAccuracy(summary.latest)}</td>
            <td>
              <span className={`status-badge status-badge-${summary.status}`}>{STATUS_LABEL[summary.status]}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

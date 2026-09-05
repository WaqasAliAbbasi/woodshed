import { useEffect, useState } from 'react'
import { SECTION_STATUS_LABEL } from '../../lib/coach/suggestNextStep'
import { summarizeSectionProgress, type SectionProgress } from '../../lib/coach/pieceProgress'
import { listAttemptsForPiece } from '../../lib/db/attemptsRepo'
import { listSectionsForPiece } from '../../lib/db/sectionsRepo'

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
    <div className="shelf">
      {summaries.map((summary) => (
        <div key={summary.section.id} className={`tile tile-${summary.status}`}>
          <span className="tile-range">{summary.section.label}</span>
          <span className="tile-status">
            <span className="tile-dot" />
            {SECTION_STATUS_LABEL[summary.status]}
          </span>
          <span className="tile-meta">{summary.attemptCount} {summary.attemptCount === 1 ? 'attempt' : 'attempts'}</span>
          <span className="tile-meta">Best {formatAccuracy(summary.best)}</span>
          <span className="tile-meta">Latest {formatAccuracy(summary.latest)}</span>
        </div>
      ))}
    </div>
  )
}

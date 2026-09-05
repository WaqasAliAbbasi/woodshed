import { useEffect, useState } from 'react'
import { listAttemptsForSection } from '../../lib/db/attemptsRepo'
import type { Attempt } from '../../lib/db/db'

export function HistoryView({ sectionId, refreshKey }: { sectionId: string | undefined; refreshKey: number }) {
  const [attempts, setAttempts] = useState<Attempt[]>([])

  useEffect(() => {
    if (!sectionId) {
      setAttempts([])
      return
    }
    let cancelled = false
    listAttemptsForSection(sectionId).then((result) => {
      if (!cancelled) setAttempts(result.slice().sort((a, b) => b.timestamp - a.timestamp))
    })
    return () => {
      cancelled = true
    }
  }, [sectionId, refreshKey])

  if (!sectionId || attempts.length === 0) {
    return <p className="history-empty">No attempts yet for this section.</p>
  }

  return (
    <table className="history-table">
      <thead>
        <tr>
          <th>When</th>
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

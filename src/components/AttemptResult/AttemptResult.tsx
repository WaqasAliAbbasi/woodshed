import type { AttemptAggregate } from '../../lib/scoring/types'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

export function AttemptResult({ aggregate, aborted }: { aggregate: AttemptAggregate; aborted: boolean }) {
  return (
    <div className="attempt-result">
      {aborted && <p className="banner banner-warning">Attempt stopped early.</p>}
      <div className="attempt-stats">
        <Stat label="Pitch accuracy" value={`${Math.round(aggregate.pitchAccuracy * 100)}%`} />
        <Stat label="Timing accuracy" value={`${Math.round(aggregate.timingAccuracy * 100)}%`} />
        <Stat label="Correct" value={aggregate.correct} />
        <Stat label="Missed" value={aggregate.missed} />
        <Stat label="Wrong notes" value={aggregate.extra} />
        <Stat label="On time / Early / Late" value={`${aggregate.onTime} / ${aggregate.early} / ${aggregate.late}`} />
      </div>
    </div>
  )
}

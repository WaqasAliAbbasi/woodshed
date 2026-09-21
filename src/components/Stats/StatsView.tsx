import { useEffect, useMemo, useRef, useState } from 'react'
import { listAllAttempts } from '../../lib/db/attemptsRepo'
import type { Attempt, PracticeSession } from '../../lib/db/db'
import { listPieces, type PieceSummary } from '../../lib/db/piecesRepo'
import { listSessions } from '../../lib/db/sessionsRepo'
import { buildPieceStatsMap, formatDuration } from '../../lib/pieceStats'
import { buildDailyMinutesMap, buildHeatmapDays, dailyBuckets, weeklyBuckets, type HeatmapDay, type MinutesBucket } from './dailyMinutes'

type AttemptSummary = Pick<Attempt, 'pieceId' | 'timestamp' | 'durationMs'>

type Range = '7d' | '30d' | '1y'

const HEATMAP_WEEKS = 26

function BarChart({ buckets }: { buckets: MinutesBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.minutes))
  return (
    <div className="stats-bar-chart">
      {buckets.map((b, i) => (
        <div key={i} className="stats-bar-col" title={`${b.label}: ${formatDuration(b.minutes * 60_000)}`}>
          <div className="stats-bar" style={{ height: `${Math.max(2, (b.minutes / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  )
}

/** A GitHub-style contribution grid, one column per week (oldest to newest, left to right) and one row per weekday — `--accent` at an opacity proportional to that day's minutes, capped so one very long day doesn't wash out the rest of the scale. */
function Heatmap({ days }: { days: HeatmapDay[] }) {
  // Pad the front so the grid starts on a Sunday — otherwise the first
  // partial week would draw its cells in the wrong rows.
  const firstDow = new Date(days[0].dayKey).getDay()
  const padded: (HeatmapDay | undefined)[] = [...Array(firstDow).fill(undefined), ...days]
  const maxMinutes = Math.max(1, ...days.map((d) => d.minutes))
  const scrollRef = useRef<HTMLDivElement>(null)

  // The grid is wider than the panel (26 weeks of cells), so it scrolls —
  // and starts scrolled to its left edge by default, which is the oldest
  // week. Recent practice (the whole point of glancing at this) would sit
  // just past the right edge, unscrolled-to, on first render. Snap to the
  // end so today's column is what's actually visible.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [days])

  // `grid-auto-flow: column` (see App.css) fills columns top-to-bottom
  // before starting the next one, so 7 cells per column with a fixed
  // `grid-template-rows: repeat(7, 1fr)` is all it takes to lay this out
  // as weeks left-to-right without computing a column count here.
  return (
    <div className="stats-heatmap" ref={scrollRef}>
      {padded.map((day, i) => {
        if (!day) return <div key={i} className="stats-heatmap-cell stats-heatmap-cell-empty" />
        const intensity = day.minutes === 0 ? 0 : Math.min(1, day.minutes / maxMinutes) * 0.8 + 0.2
        return (
          <div
            key={i}
            className="stats-heatmap-cell"
            style={day.minutes > 0 ? { backgroundColor: `color-mix(in srgb, var(--accent) ${Math.round(intensity * 100)}%, var(--surface))` } : undefined}
            title={`${new Date(day.dayKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}: ${formatDuration(day.minutes * 60_000)}`}
          />
        )
      })}
    </div>
  )
}

/** Practice time split by piece, from scored attempt time — see this component's own doc comment on why sessions (which can span more than one piece) aren't the source for this particular chart. */
function PieceBreakdown({ attempts, pieces }: { attempts: AttemptSummary[]; pieces: PieceSummary[] }) {
  const statsByPieceId = buildPieceStatsMap(attempts)
  const titleById = new Map(pieces.map((p) => [p.id, p.title]))
  const rows = Array.from(statsByPieceId.entries())
    .map(([pieceId, stats]) => ({ pieceId, title: titleById.get(pieceId) ?? 'Deleted piece', totalDurationMs: stats.totalDurationMs }))
    .filter((r) => r.totalDurationMs > 0)
    .sort((a, b) => b.totalDurationMs - a.totalDurationMs)

  if (rows.length === 0) return <p className="history-empty">No scored practice time yet.</p>

  const max = Math.max(...rows.map((r) => r.totalDurationMs))
  return (
    <ul className="stats-piece-breakdown">
      {rows.map((row) => (
        <li key={row.pieceId} className="stats-piece-row">
          <span className="stats-piece-title">{row.title}</span>
          <div className="stats-piece-bar-track">
            <div className="stats-piece-bar" style={{ width: `${(row.totalDurationMs / max) * 100}%` }} />
          </div>
          <span className="stats-piece-value">{formatDuration(row.totalDurationMs)}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * All computed client-side from `/api/sessions` and `/api/attempts/summary`
 * — no new server aggregation, and no charting dependency (hand-rolled
 * bars/grid — this project carries no charting library, and a heatmap plus
 * a bar chart is a few dozen lines each). See docs/sessions-plan.md.
 *
 * The practice-time chart and the calendar heatmap read from *sessions*
 * (derived + manual, so a day logged by hand counts); the per-piece
 * breakdown reads from *attempts* instead, because a derived session can
 * span more than one piece in one sitting and has no honest way to split
 * its minutes between them — an attempt's `durationMs` is unambiguously
 * one piece's time, same source `pieceStats.ts` already uses for the
 * library list.
 */
export function StatsView() {
  const [sessions, setSessions] = useState<PracticeSession[] | undefined>(undefined)
  const [attempts, setAttempts] = useState<AttemptSummary[]>([])
  const [pieces, setPieces] = useState<PieceSummary[]>([])
  const [range, setRange] = useState<Range>('30d')

  useEffect(() => {
    void Promise.all([listSessions(), listAllAttempts(), listPieces()]).then(([loadedSessions, loadedAttempts, loadedPieces]) => {
      setSessions(loadedSessions)
      setAttempts(loadedAttempts)
      setPieces(loadedPieces)
    })
  }, [])

  const dailyMinutes = useMemo(() => buildDailyMinutesMap(sessions ?? []), [sessions])
  const heatmapDays = useMemo(() => buildHeatmapDays(dailyMinutes, HEATMAP_WEEKS * 7), [dailyMinutes])
  const buckets = useMemo(() => {
    if (range === '7d') return dailyBuckets(dailyMinutes, 7)
    if (range === '30d') return dailyBuckets(dailyMinutes, 30)
    return weeklyBuckets(dailyMinutes, 52)
  }, [dailyMinutes, range])
  const totalMinutesInRange = useMemo(() => buckets.reduce((sum, b) => sum + b.minutes, 0), [buckets])

  if (sessions === undefined) return null

  return (
    <div className="stats-view panel">
      <h2>Stats</h2>

      <section className="stats-section">
        <div className="stats-section-header">
          <h3>Practice time</h3>
          <div className="stats-range-control" role="group" aria-label="Time range">
            {(['7d', '30d', '1y'] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={`stats-range-btn${r === range ? ' stats-range-btn-active' : ''}`}
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <p className="stats-total">{formatDuration(totalMinutesInRange * 60_000)} total</p>
        <BarChart buckets={buckets} />
      </section>

      <section className="stats-section">
        <h3>Practice calendar</h3>
        <Heatmap days={heatmapDays} />
      </section>

      <section className="stats-section">
        <h3>Time by piece</h3>
        <PieceBreakdown attempts={attempts} pieces={pieces} />
      </section>
    </div>
  )
}

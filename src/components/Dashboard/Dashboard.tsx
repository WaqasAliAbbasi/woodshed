import { useEffect, useState } from 'react'
import { listAllAttempts } from '../../lib/db/attemptsRepo'
import { listPieces, type PieceSummary } from '../../lib/db/piecesRepo'
import { buildPieceStatsMap, formatDuration, formatPracticeDate, sortPiecesByRecency, type PieceStats } from '../../lib/pieceStats'
import { computeStreak, type StreakSummary } from '../../lib/streak'

/**
 * Read-only practice overview — streak, and every piece's practice stats —
 * meant to be opened from a phone: nothing here lets you upload a piece or
 * practice (that still needs a MIDI keyboard, see PracticeWorkspace), just
 * "how am I doing". Built entirely from the same `/api/pieces` +
 * `/api/attempts/summary` data and the same pure functions
 * (`buildPieceStatsMap`, `computeStreak`) the main app and the MCP tools
 * use — see App.tsx's `/dashboard` path check for how this gets reached.
 */
export function Dashboard() {
  const [loaded, setLoaded] = useState<{ pieces: PieceSummary[]; statsByPieceId: Map<string, PieceStats>; streak: StreakSummary } | undefined>(
    undefined,
  )
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    Promise.all([listPieces(), listAllAttempts()])
      .then(([pieces, attempts]) => {
        setLoaded({ pieces, statsByPieceId: buildPieceStatsMap(attempts), streak: computeStreak(attempts) })
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  return (
    <main className="app dashboard">
      <header className="brand">
        <h1>Practice Dashboard</h1>
        <a className="link-back app-logout" href="/">
          Open Woodshed
        </a>
      </header>

      {error && <div className="banner banner-error">{error}</div>}
      {!loaded && !error && <p>Loading…</p>}

      {loaded && (
        <>
          <section className="panel dashboard-streak">
            <div className="dashboard-streak-figure">
              <span className="dashboard-streak-number">{loaded.streak.current}</span>
              <span className="dashboard-streak-label">day{loaded.streak.current === 1 ? '' : 's'} current streak</span>
            </div>
            {loaded.streak.longest > loaded.streak.current && (
              <p className="dashboard-streak-best">Best streak: {loaded.streak.longest} days</p>
            )}
            {loaded.streak.current === 0 && loaded.streak.lastPracticedDay !== undefined && (
              <p className="dashboard-streak-best">Last practiced {formatPracticeDate(loaded.streak.lastPracticedDay)} — get back to it!</p>
            )}
          </section>

          <section className="panel">
            <h2>Pieces</h2>
            {loaded.pieces.length === 0 ? (
              <p>No pieces yet — upload one from the main app to get started.</p>
            ) : (
              <ul className="dashboard-piece-list">
                {sortPiecesByRecency(loaded.pieces, loaded.statsByPieceId).map((piece) => {
                  const stats = loaded.statsByPieceId.get(piece.id)
                  return (
                    <li key={piece.id} className="dashboard-piece-row">
                      <span className="piece-title">{piece.title}</span>
                      {piece.composer && <span className="piece-composer">{piece.composer}</span>}
                      {stats ? (
                        <span className="piece-meta">
                          {formatDuration(stats.totalDurationMs)} practiced · last {formatPracticeDate(stats.lastPracticedAt)}
                        </span>
                      ) : (
                        <span className="piece-meta">Not practiced yet</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  )
}

import { useMemo, useState } from 'react'
import { timingQuality } from '../../lib/coach/suggestNextStep'
import { updateSession } from '../../lib/db/sessionsRepo'
import { buildDailyPlan } from '../../lib/path/buildDailyPlan'
import { nextLessonDate, shortDate } from '../../lib/path/deriveState'
import { describeItem, type PiecePath } from '../../lib/path/nextStep'
import { isReadyAttempt, startOfDay } from '../../lib/path/rungProgress'
import { navigate } from '../../lib/router'
import { getBudget } from './planProgress'
import { usePathData } from './usePathData'
import { CheckMark } from './icons'
import './path.css'

const DAY_MS = 24 * 60 * 60 * 1000

interface TodayLine {
  tag: string
  text: string
  good: boolean
}

/** What moved today on one piece's path: rungs and joins passed, and tempo climbed on a chunk still building. */
function todayLines(title: string, path: PiecePath, dayStart: number, bestTempoToday: Map<string, number>, target: number): TodayLine[] {
  const lines: TodayLine[] = []
  for (const c of path.chunks) {
    if (c.repeatOf !== undefined) continue
    const p = c.progress
    const name = `${title} · chunk ${c.number}`
    if (p.readyAt !== undefined && p.readyAt >= dayStart) lines.push({ tag: 'Ready', text: name, good: true })
    else if (p.rung3.passedAt !== undefined && p.rung3.passedAt >= dayStart) lines.push({ tag: 'Passed', text: `${name}, metronome`, good: true })
    else if (p.rung2.passedAt !== undefined && p.rung2.passedAt >= dayStart) lines.push({ tag: 'Passed', text: `${name}, notes`, good: true })
    else if (p.current === 'tempo' && bestTempoToday.has(c.chunk.id)) {
      lines.push({ tag: `Up to ${bestTempoToday.get(c.chunk.id)}`, text: `${name}, target ${target}`, good: false })
    }
  }
  for (const j of path.joins) {
    if (j.passedAt !== undefined && j.passedAt >= dayStart) {
      lines.push({ tag: j.whole ? 'Whole piece' : 'Joined', text: `${title} · ${describeItem({ kind: 'join', k: j.k }, path.chunks.length)}`, good: true })
    }
  }
  return lines
}

/** The session-end note (`SessionEnd` artboard) — only shown when the student presses Finish. Phone-friendly. */
export function SessionEnd() {
  const { overview, derived, error } = usePathData()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [now] = useState(() => Date.now())
  const tomorrow = useMemo(() => (derived ? buildDailyPlan(derived.plan, now + DAY_MS, getBudget()) : undefined), [derived, now])

  if (error) return <div className="path"><p className="p-error">{error}</p></div>
  if (!overview || !derived || !tomorrow) return <div className="path"><p className="p-muted">Loading…</p></div>

  const dayStart = startOfDay(now)
  const sectionById = new Map(overview.sections.map((s) => [s.id, s]))
  const today = overview.attempts.filter((a) => a.timestamp >= dayStart).sort((a, b) => a.timestamp - b.timestamp)
  const minutes = Math.round(today.reduce((sum, a) => sum + (a.durationMs ?? 0), 0) / 60_000)
  const pieceIds = [...new Set(today.map((a) => a.pieceId))]
  const titles = new Map(overview.pieces.map((p) => [p.id, p.title]))

  const win = [...today].reverse().find((a) => sectionById.get(a.sectionId)?.rung === 'review' && !a.aborted)
  const winSection = win ? sectionById.get(win.sectionId) : undefined
  const wonIt = win ? isReadyAttempt(win) : false

  const bestTempoToday = new Map<string, number>()
  for (const a of today) {
    const s = sectionById.get(a.sectionId)
    if (s?.rung === 'tempo' && s.chunkId && isReadyAttempt(a)) bestTempoToday.set(s.chunkId, Math.max(bestTempoToday.get(s.chunkId) ?? 0, a.tempoBpm))
  }
  const lines = pieceIds.flatMap((id) => {
    const path = derived.paths.get(id)
    return path ? todayLines(titles.get(id) ?? '', path, dayStart, bestTempoToday, derived.targets.get(id) ?? 80) : []
  })

  const sessionId = today.at(-1)?.sessionId
  const lessonDay = nextLessonDate(now + DAY_MS, overview.settings.lessonWeekday)

  const finish = async () => {
    setSaving(true)
    try {
      if (sessionId && note.trim()) await updateSession(sessionId, { note: note.trim() })
    } finally {
      navigate('/')
    }
  }

  return (
    <div className="path">
      <div className="p-split">
        <section className="p-main">
          <div>
            <p className="p-eyebrow">
              {pieceIds.length} piece{pieceIds.length === 1 ? '' : 's'} · {minutes} minute{minutes === 1 ? '' : 's'}
            </p>
            <h1 className="p-h1">{wonIt ? 'Done for today, on a win' : 'Done for today'}</h1>
          </div>

          {win && winSection && (
            <div className={wonIt ? 'p-win' : 'p-card p-win-miss'}>
              <span className={`p-result-mark${wonIt ? '' : ' p-result-mark-miss'}`} style={{ width: 52, height: 52 }} aria-hidden="true">
                {wonIt ? <CheckMark size={28} /> : <span className="p-result-dot" />}
              </span>
              <div style={{ flex: '1 1 240px' }}>
                <p style={{ fontWeight: 600 }}>
                  {titles.get(win.pieceId)} · {winSection.label.replace(' · Review', '')} at {win.tempoBpm} bpm
                </p>
                <p style={{ fontSize: 17 }}>
                  Measures {winSection.startMeasure}–{winSection.endMeasure}, pitch {Math.round(win.aggregate.pitchAccuracy * 100)}%, rhythm{' '}
                  {Math.round(timingQuality(win.aggregate) * 100)}%
                </p>
              </div>
            </div>
          )}

          {lines.length === 0 && !win && <p className="p-muted">Nothing played on the path today yet. Tomorrow's plan is ready when you are.</p>}

          {lines.length > 0 && (
            <div>
              <h2 className="p-h2" style={{ marginBottom: 12, fontSize: 26 }}>
                Today
              </h2>
              <ul className="p-steps" style={{ gap: 10 }}>
                {lines.map((line, i) => (
                  <li key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: 19 }}>
                    <span style={{ flex: '0 0 120px', fontWeight: 600, color: line.good ? 'var(--success-text)' : 'var(--accent-soft-text)' }}>{line.tag}</span>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sessionId && (
            <label className="p-field">
              One line for next time
              <input type="text" value={note} placeholder="e.g. m. 8 left hand still shaky" onChange={(e) => setNote(e.target.value)} />
              <span className="p-muted p-small" style={{ fontWeight: 400 }}>
                Your note shows at the top of the next plan.
              </span>
            </label>
          )}
        </section>

        <aside className="p-side p-card p-next-session" aria-label="Next time">
          <div>
            <p className="p-eyebrow" style={{ marginBottom: 4 }}>
              Next session
            </p>
            <p className="p-h2">Tomorrow, about {tomorrow.minutes || getBudget()} minutes</p>
          </div>
          {tomorrow.steps.length > 0 ? (
            <ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 18 }}>
              {tomorrow.steps.map((s) => (
                <li key={s.key}>
                  {s.kind === 'win' ? `End on ${s.what}` : `${s.title} · ${s.what}`}
                </li>
              ))}
            </ol>
          ) : (
            <p className="p-muted">Nothing assigned yet — log your next lesson.</p>
          )}
          {lessonDay !== undefined && <p className="p-banner">Next lesson {shortDate(lessonDay)}</p>}
          <button type="button" className="p-btn p-btn-primary" style={{ minHeight: 72, fontSize: 22 }} disabled={saving} onClick={() => void finish()}>
            Save and finish
          </button>
        </aside>
      </div>
    </div>
  )
}

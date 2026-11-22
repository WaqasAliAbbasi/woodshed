import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PracticeSession } from '../../lib/db/db'
import type { Collection, Lesson, PathOverview } from '../../lib/db/pathRepo'
import { createManualSession, deleteSession, listSessions, updateSession } from '../../lib/db/sessionsRepo'
import { collapseEmptyWeeks, formatMinutes, groupByLessonWeek, isGap, type LessonWeek } from '../../lib/lessonWeeks'
import { nextLessonDate, shortDate, type DerivedState } from '../../lib/path/deriveState'
import { describeStep, piecePath } from '../../lib/path/nextStep'
import { practiceDayKey } from '../../lib/streak'
import { AppLink } from '../AppShell/AppShell'
import { CollectionFilter } from '../Collections/CollectionFilter'
import { shortCollectionName } from '../Path/links'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import { usePathData } from '../Path/usePathData'
import { ManualSessionForm } from './ManualSessionForm'
import { filterByPieces, isLessonSession, piecesOf } from './sessionKinds'
import '../Path/path.css'
import './sessions.css'

const OUTCOME_WORD = { finished: 'marked done', continue: 'keep going', new: 'new' } as const

/** "Sat 14". */
function dayLabel(ms: number): string {
  return shortDate(ms).split(' ').slice(0, 2).join(' ')
}

/** What a practice session moved on the path: chunks that became ready, joins passed — else what it was working on. */
function pathOutcome(s: PracticeSession, overview: PathOverview, derived: DerivedState): string | undefined {
  const attempts = overview.attempts.filter((a) => a.sessionId === s.id)
  if (attempts.length === 0) return undefined
  const parts: string[] = []
  for (const pieceId of [...new Set(attempts.map((a) => a.pieceId))]) {
    const chunks = overview.chunks.filter((c) => c.pieceId === pieceId)
    if (chunks.length === 0) continue
    const input = {
      chunks,
      sections: overview.sections.filter((x) => x.pieceId === pieceId),
      targetTempoBpm: derived.targets.get(pieceId) ?? 80,
    }
    const all = overview.attempts.filter((a) => a.pieceId === pieceId)
    const before = piecePath({ ...input, attempts: all.filter((a) => a.timestamp < s.startedAt), now: s.startedAt })
    const after = piecePath({ ...input, attempts: all.filter((a) => a.timestamp <= s.endedAt), now: s.endedAt })
    const readied = after.chunks.filter((c, i) => c.repeatOf === undefined && c.progress.ready && !before.chunks[i].progress.ready)
    const joined = after.joins.filter((j, i) => j.passed && !before.joins[i]?.passed)
    const moved = [
      ...readied.map((c) => `m. ${c.chunk.startMeasure}–${c.chunk.endMeasure}`),
      ...joined.map((j) => (j.whole ? 'the whole piece' : `m. ${j.startMeasure}–${j.endMeasure} joined`)),
    ]
    const tries = attempts.filter((a) => a.pieceId === pieceId).length
    parts.push(
      moved.length > 0
        ? `Ready: ${moved.join(', ')}`
        : `${tries} tr${tries === 1 ? 'y' : 'ies'}${after.next.kind !== 'complete' ? ` · working on ${describeStep(after.next)}` : ''}`,
    )
  }
  return parts.join(' · ') || undefined
}

/** Click-to-edit note — draft until committed, Enter with Cmd/Ctrl or blur saves, Escape cancels. On derived sessions too: a note in retrospect is why sessions are stored rows. */
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
      onSaved(await updateSession(session.id, { note: trimmed || null }))
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <textarea
        className="s-note-edit"
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
      className={session.note ? 's-note' : 's-note-add'}
      onClick={() => {
        setDraft(session.note ?? '')
        setEditing(true)
      }}
    >
      {session.note || 'Add a note'}
    </button>
  )
}

interface CardContext {
  overview: PathOverview
  derived: DerivedState
  lessons: Map<string, Lesson>
  titles: Map<string, string>
  onNoteSaved: (s: PracticeSession) => void
  onDelete: (s: PracticeSession) => void
}

function collectionTags(pieceIds: string[], collections: Collection[]): string[] {
  return [...new Set(collections.filter((c) => c.pieces.some((p) => pieceIds.includes(p.pieceId))).map(shortCollectionName))]
}

function SessionCard({ session, ctx }: { session: PracticeSession; ctx: CardContext }) {
  const lesson = ctx.lessons.get(session.id)
  const isLesson = isLessonSession(session, ctx.lessons)
  const pieceIds = piecesOf(session, ctx.lessons)
  const titles = pieceIds.map((id) => ctx.titles.get(id) ?? 'Deleted piece')
  const title = titles.length > 0 ? titles.join(', ') : session.label || (isLesson ? 'Lesson' : 'Practice')
  const outcome = lesson
    ? lesson.pieces.map((p) => `${ctx.titles.get(p.pieceId) ?? 'Deleted piece'}: ${OUTCOME_WORD[p.outcome]}${p.focus ? `, ${p.focus}` : ''}`).join(' · ')
    : session.source === 'derived'
      ? pathOutcome(session, ctx.overview, ctx.derived)
      : session.label && titles.length > 0 && !isLesson
        ? session.label
        : undefined
  const minutes = (session.endedAt - session.startedAt) / 60_000

  return (
    <article className={`s-card${isLesson ? ' s-card-lesson' : ''}`}>
      <div className="s-card-when">
        <p className="s-card-day">{dayLabel(practiceDayKey(session.startedAt))}</p>
        <p className="p-muted s-card-mins">{formatMinutes(minutes)}</p>
      </div>
      <div className="s-card-body">
        <p className="s-card-head">
          <span className={`s-kind${isLesson ? ' s-kind-lesson' : ''}`}>{isLesson ? 'Lesson' : 'Practice'}</span>
          <strong>{title}</strong>
          {collectionTags(pieceIds, ctx.overview.collections).map((t) => (
            <span key={t} className="p-tag">
              {t}
            </span>
          ))}
        </p>
        {outcome && <p className="s-card-outcome">{outcome}</p>}
        <EditableNote session={session} onSaved={ctx.onNoteSaved} />
      </div>
      {session.source === 'manual' && (
        <button type="button" className="s-delete" aria-label="Delete logged session" onClick={() => ctx.onDelete(session)}>
          Delete
        </button>
      )}
    </article>
  )
}

function WeekDots({ days }: { days: boolean[] }) {
  return (
    <span className="s-dots" aria-label={`${days.filter(Boolean).length} of 7 days practised`}>
      {days.map((on, i) => (
        <span key={i} className={on ? 's-dot-on' : undefined} />
      ))}
    </span>
  )
}

function weekSummary(w: LessonWeek<PracticeSession>): string {
  if (w.practiceDays > 0) return `${w.practiceDays} day${w.practiceDays === 1 ? '' : 's'} · ${formatMinutes(w.practiceMinutes)}`
  return w.lessons.length > 0 ? 'no practice' : 'no practice, no lesson logged'
}

function WeekSection({ week, ctx, lessonDaySet }: { week: LessonWeek<PracticeSession>; ctx: CardContext; lessonDaySet: boolean }) {
  const label = `Week to ${week.lessons.length > 0 && lessonDaySet ? 'lesson ' : ''}${shortDate(week.end)}`
  const items = [...week.lessons, ...week.practice].sort((a, b) => b.startedAt - a.startedAt)
  return (
    <section className="s-week" aria-label={label}>
      <div className="s-week-head">
        <h2 className="s-week-title">{label}</h2>
        <p className="s-week-summary">
          <WeekDots days={week.days} />
          {weekSummary(week)}
        </p>
      </div>
      {week.onlyOnLessonDay && <p className="p-banner">The only practice this week was on the day of the lesson.</p>}
      {items.map((s) => (
        <SessionCard key={s.id} session={s} ctx={ctx} />
      ))}
    </section>
  )
}

/**
 * Sessions (`Sessions` / `PhoneSessions` artboards): history grouped into the
 * week before each lesson, each with its seven day-dots and a summary;
 * lesson cards set apart from practice; runs of empty weeks folded into one
 * line. Derived sessions (from attempts) and manual ones (logged by hand)
 * are both here — see docs/sessions-plan.md.
 */
export function SessionsView() {
  const { overview, derived, error: pathError } = usePathData()
  const [sessions, setSessions] = useState<PracticeSession[] | undefined>(undefined)
  const [filter, setFilter] = useState<string | undefined>(undefined)
  const [showForm, setShowForm] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<PracticeSession | undefined>(undefined)
  const [openGaps, setOpenGaps] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | undefined>(undefined)
  const [now] = useState(() => Date.now())

  const refresh = useCallback(() => listSessions().then(setSessions), [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const lessons = useMemo(() => new Map((overview?.lessons ?? []).map((l) => [l.sessionId, l])), [overview])
  const weekday = overview?.settings.lessonWeekday

  const weeks = useMemo(() => {
    if (!sessions) return undefined
    const members = filter ? new Set(overview?.collections.find((c) => c.id === filter)?.pieces.map((p) => p.pieceId)) : undefined
    const shown = filterByPieces(sessions, lessons, members)
    return groupByLessonWeek(shown, (s) => isLessonSession(s, lessons), weekday, now)
  }, [sessions, filter, overview, lessons, weekday, now])

  if (pathError) return <div className="path"><p className="p-error">{pathError}</p></div>
  if (!overview || !derived || !weeks) return <div className="path"><p className="p-muted">Loading sessions…</p></div>

  const ctx: CardContext = {
    overview,
    derived,
    lessons,
    titles: new Map(overview.pieces.map((p) => [p.id, p.title])),
    onNoteSaved: (updated) => setSessions((cur) => cur?.map((s) => (s.id === updated.id ? updated : s))),
    onDelete: setPendingDelete,
  }

  const [current, ...past] = weeks
  const lessonDay = nextLessonDate(now, weekday)
  const daysLeft = lessonDay !== undefined ? Math.round((lessonDay - practiceDayKey(now)) / 86_400_000) : undefined
  const currentSummary =
    current.practiceDays > 0
      ? `${current.practiceDays} day${current.practiceDays === 1 ? '' : 's'} · ${formatMinutes(current.practiceMinutes)} so far`
      : 'No practice yet'
  const toGo =
    daysLeft === undefined ? undefined : daysLeft === 0 ? 'lesson today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} before the lesson`

  const handleDelete = async (session: PracticeSession) => {
    setPendingDelete(undefined)
    setError(undefined)
    try {
      await deleteSession(session.id)
      setSessions((cur) => cur?.filter((s) => s.id !== session.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="path">
      <div className="p-header">
        <div>
          <h1 className="p-h1">Sessions</h1>
          <p className="p-muted" style={{ marginTop: 6 }}>
            {weekday !== undefined ? 'Grouped by the week before each lesson' : 'Grouped by week'}
          </p>
        </div>
        <div className="p-actions">
          <button type="button" className="p-btn p-btn-small" onClick={() => setShowForm(true)}>
            Log practice
          </button>
          <AppLink href="/lesson" className="p-btn p-btn-small s-btn-pine">
            Log lesson
          </AppLink>
        </div>
      </div>

      <CollectionFilter collections={overview.collections} value={filter} onChange={setFilter} />
      {error && <p className="p-error">{error}</p>}

      {showForm && (
        <section className="p-card">
          <ManualSessionForm
            pieces={overview.pieces}
            onCancel={() => setShowForm(false)}
            onSubmit={(input) => {
              setError(undefined)
              void createManualSession(input)
                .then(() => {
                  setShowForm(false)
                  return refresh()
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
            }}
          />
        </section>
      )}

      <section className="p-card p-card-accent s-this-week" aria-label="This week">
        <div>
          <h2 className="s-this-week-title">This week{lessonDay !== undefined ? ` · lesson ${shortDate(lessonDay)}` : ''}</h2>
          <p className="p-muted p-small">{[currentSummary, toGo].filter(Boolean).join(' · ')}</p>
        </div>
        <AppLink href="/" className="p-btn s-btn-pine">
          Start today's plan
        </AppLink>
      </section>
      {[...current.lessons, ...current.practice]
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((s) => (
          <SessionCard key={s.id} session={s} ctx={ctx} />
        ))}

      {collapseEmptyWeeks(past).map((entry) => {
        if (!isGap(entry)) return <WeekSection key={entry.end} week={entry} ctx={ctx} lessonDaySet={weekday !== undefined} />
        if (openGaps.has(entry.end)) {
          return entry.weeks.map((w) => <WeekSection key={w.end} week={w} ctx={ctx} lessonDaySet={weekday !== undefined} />)
        }
        return (
          <button key={entry.end} type="button" className="s-gap" onClick={() => setOpenGaps((g) => new Set(g).add(entry.end))}>
            <span className="s-gap-dot" aria-hidden="true" />
            {entry.weeks.length} weeks with no home practice ({shortDate(entry.start).slice(4)} – {shortDate(entry.end).slice(4)})
            {entry.lessonCount > 0 ? ` · ${entry.lessonCount} lesson${entry.lessonCount === 1 ? '' : 's'} logged` : ''}
          </button>
        )
      })}

      {sessions && sessions.length === 0 && <p className="p-muted">No sessions yet. They appear here as you practise, or log one by hand.</p>}

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

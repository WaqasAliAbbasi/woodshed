import { useMemo, useState } from 'react'
import { updateSettings } from '../../lib/db/pathRepo'
import { BUDGET_CHOICES, buildDailyPlan, type PlanStep } from '../../lib/path/buildDailyPlan'
import { nextLessonDate, shortDate } from '../../lib/path/deriveState'
import type { PiecePath } from '../../lib/path/nextStep'
import { navigate } from '../../lib/router'
import { finishHref, playHref, WEEKDAY_NAMES } from './links'
import { doneSteps, getBudget, setBudget as storeBudget } from './planProgress'
import { usePathData } from './usePathData'
import './path.css'

export function ChunkCells({ path }: { path: PiecePath }) {
  return (
    <div className="p-cells" aria-hidden="true">
      {path.chunks.map((c) => (
        <span
          key={c.chunk.id}
          className={c.progress.ready ? 'p-cell-ready' : c.progress.rung2.tries > 0 || c.progress.rung2.passed ? 'p-cell-now' : undefined}
        />
      ))}
    </div>
  )
}

function StepRow({ step, index, state }: { step: PlanStep; index: number; state: 'done' | 'current' | 'pending' }) {
  return (
    <li className={`p-step${state === 'current' ? ' p-step-current' : state === 'done' ? ' p-step-done' : ''}`}>
      <span className="p-step-mark" aria-label={state === 'done' ? 'Done' : state === 'current' ? 'Up next' : undefined}>
        {state === 'done' ? '✓' : state === 'pending' ? index + 1 : ''}
      </span>
      <div className="p-step-body">
        <p className="p-step-title">
          <strong>{step.title}</strong>
          <span className="p-small">{step.what}</span>
        </p>
        <p className="p-step-why">{step.why}</p>
      </div>
      <span className="p-step-mins">{step.minutes} min</span>
    </li>
  )
}

/**
 * Today's plan (`TodayPlan` artboard): recomputed from the current state
 * every time it opens, across every piece the last lesson assigned.
 * Phone-friendly — it's where planning happens away from the piano.
 */
export function TodayPlan() {
  const { overview, derived, error, reload } = usePathData()
  const [budget, setBudget] = useState(getBudget)
  const [now] = useState(() => Date.now())
  const plan = useMemo(() => (derived ? buildDailyPlan(derived.plan, now, budget) : undefined), [derived, now, budget])

  if (error) return <div className="path"><p className="p-error">{error}</p></div>
  if (!overview || !derived || !plan) return <div className="path"><p className="p-muted">Loading today's plan…</p></div>

  const done = doneSteps()
  const current = plan.steps.find((s) => !done.has(s.key))
  const lessonDay = nextLessonDate(now, overview.settings.lessonWeekday)
  const titleById = new Map(overview.pieces.map((p) => [p.id, p.title]))
  const examIds = new Set(overview.collections.filter((c) => c.kind === 'exam').flatMap((c) => c.pieces.map((p) => p.pieceId)))
  const asideIds = [
    ...plan.activePieceIds,
    ...derived.plan.pieces.filter((p) => p.inExam && (p.finished || p.path?.complete) && !plan.activePieceIds.includes(p.pieceId)).map((p) => p.pieceId),
  ]

  const eyebrow = [
    `${plan.activePieceIds.length} piece${plan.activePieceIds.length === 1 ? '' : 's'}`,
    lessonDay !== undefined ? `lesson ${shortDate(lessonDay)}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ')

  const chooseBudget = (minutes: number) => {
    setBudget(minutes)
    storeBudget(minutes)
  }

  return (
    <div className="path">
      <div className="p-split">
        <section className="p-main">
          <div>
            <p className="p-eyebrow">{eyebrow}</p>
            <h1 className="p-h1">Today, about {plan.minutes || budget} minutes</h1>
          </div>
          <div className="p-actions">
            <span className="p-muted p-small">Time today</span>
            <div className="p-segmented" role="group" aria-label="Minutes today">
              {BUDGET_CHOICES.map((m) => (
                <button key={m} type="button" aria-pressed={budget === m} onClick={() => chooseBudget(m)}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          {(plan.focus.length > 0 || overview.lastNote) && (
            <div className="p-banner">
              {plan.focus.length > 0 && (
                <p>
                  <strong>From your last lesson:</strong> {plan.focus.map((f) => `${f.title}, ${f.focus}`).join(' · ')}
                </p>
              )}
              {overview.lastNote && (
                <p>
                  <strong>Your note:</strong> {overview.lastNote.note}
                </p>
              )}
            </div>
          )}

          {plan.steps.length === 0 ? (
            <EmptyPlan hasLessons={overview.lessons.length > 0} />
          ) : (
            <>
              <ol className="p-steps">
                {plan.steps.map((step, i) => (
                  <StepRow key={step.key} step={step} index={i} state={done.has(step.key) ? 'done' : step === current ? 'current' : 'pending'} />
                ))}
              </ol>
              <div className="p-actions">
                {current ? (
                  <button type="button" className="p-btn p-btn-primary" onClick={() => navigate(playHref(current.target, current))}>
                    {current.kind === 'win' ? 'End on a win' : `${done.size > 0 ? 'Continue' : 'Start'}: ${current.title}, ${current.what}`}
                  </button>
                ) : (
                  <button type="button" className="p-btn p-btn-primary" onClick={() => navigate('/done')}>
                    Finish for today
                  </button>
                )}
                {current?.kind !== 'win' && (
                  <button type="button" className="p-link" onClick={() => navigate(finishHref(plan))}>
                    Short on time? Skip to the win
                  </button>
                )}
              </div>
            </>
          )}

          <LessonDayPicker weekday={overview.settings.lessonWeekday} onChange={() => void reload()} />
        </section>

        {asideIds.length > 0 && (
          <aside className="p-side p-card" aria-label="This week's pieces">
            <h2 className="p-h2">This week's pieces</h2>
            <p className="p-muted p-small">Chunks ready, per piece</p>
            <ul className="p-pieces">
              {asideIds.map((id) => {
                const input = derived.plan.pieces.find((p) => p.pieceId === id)!
                const path = derived.paths.get(id)
                const focus = plan.focus.find((f) => f.pieceId === id)
                const status = input.finished
                  ? `Finished with your teacher · review once a week`
                  : path
                    ? path.complete
                      ? `Ready at ${input.targetTempoBpm} · whole piece done`
                      : `${path.readyChunkCount} of ${path.chunks.length} ready${focus ? ` · teacher: ${focus.focus}` : ''}`
                    : 'Not started yet'
                return (
                  <li key={id}>
                    <p className="p-step-title" style={{ justifyContent: 'space-between' }}>
                      <strong className="p-small" style={{ fontSize: 18 }}>
                        {titleById.get(id)}
                      </strong>
                      <span className="p-tag">{examIds.has(id) ? 'Exam' : input.lesson?.outcome === 'new' ? 'New' : 'Lesson'}</span>
                    </p>
                    {path && <ChunkCells path={path} />}
                    <p className="p-muted" style={{ fontSize: 15 }}>
                      {status}
                    </p>
                  </li>
                )
              })}
            </ul>
          </aside>
        )}
      </div>
    </div>
  )
}

function EmptyPlan({ hasLessons }: { hasLessons: boolean }) {
  return (
    <div className="p-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p>
        {hasLessons
          ? 'Nothing assigned right now. Pieces marked New start the day after the lesson.'
          : 'Log your last lesson and the plan builds itself from what your teacher set.'}
      </p>
      <div className="p-actions">
        <button type="button" className="p-btn p-btn-primary" onClick={() => navigate('/lesson')}>
          Log a lesson
        </button>
        <button type="button" className="p-btn" onClick={() => navigate('/library')}>
          Open the Library
        </button>
      </div>
    </div>
  )
}

function LessonDayPicker({ weekday, onChange }: { weekday: number | undefined; onChange: () => void }) {
  return (
    <label className="p-actions p-muted p-small">
      Lessons are on
      <select
        className="p-select"
        value={weekday ?? ''}
        onChange={(e) => {
          const value = e.target.value === '' ? null : Number(e.target.value)
          void updateSettings({ lessonWeekday: value }).then(onChange)
        }}
      >
        <option value="">Not set</option>
        {WEEKDAY_NAMES.map((name, i) => (
          <option key={name} value={i}>
            {name}
          </option>
        ))}
      </select>
    </label>
  )
}

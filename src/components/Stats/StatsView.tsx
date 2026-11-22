import { useEffect, useMemo, useRef, useState } from 'react'
import type { PracticeSession } from '../../lib/db/db'
import type { Collection } from '../../lib/db/pathRepo'
import { listSessions } from '../../lib/db/sessionsRepo'
import { formatMinutes, groupByLessonWeek, longestRun } from '../../lib/lessonWeeks'
import { nextLessonDate, shortDate } from '../../lib/path/deriveState'
import { practiceDayKey } from '../../lib/streak'
import { CollectionFilter } from '../Collections/CollectionFilter'
import { shortCollectionName } from '../Path/links'
import { WEEKDAY_NAMES } from '../Path/links'
import { usePathData } from '../Path/usePathData'
import { filterByPieces, isLessonSession, piecesOf } from '../Sessions/sessionKinds'
import { GOAL_DAYS, goalHeadline, minutesByPiece, shareInWords } from './weeklyStats'
import '../Path/path.css'
import './stats.css'

/** How many lesson weeks the headline chart covers. */
const WEEKS_SHOWN = 18
/** Chart height for a full seven-day week, in px. */
const CHART_PX = 180

/** "21 Nov". */
function dayMonth(ms: number): string {
  return shortDate(ms).slice(4)
}

/**
 * Stats (`Stats` / `PhoneStats` artboards). The headline is practice days
 * per lesson week against a 4-day line, with the finding as its title;
 * then a few totals, then minutes by piece grouped by collection. All of it
 * from sessions (derived and logged), never lessons: this is home practice.
 */
export function StatsView() {
  const { overview, error } = usePathData()
  const [sessions, setSessions] = useState<PracticeSession[] | undefined>(undefined)
  const [filter, setFilter] = useState<string | undefined>(undefined)
  const [now] = useState(() => Date.now())

  useEffect(() => {
    void listSessions().then(setSessions)
  }, [])

  const lessons = useMemo(() => new Map((overview?.lessons ?? []).map((l) => [l.sessionId, l])), [overview])
  const weekday = overview?.settings.lessonWeekday
  const members = useMemo(
    () => (filter ? new Set(overview?.collections.find((c) => c.id === filter)?.pieces.map((p) => p.pieceId)) : undefined),
    [filter, overview],
  )

  const stats = useMemo(() => {
    if (!sessions) return undefined
    const shown = filterByPieces(sessions, lessons, members)
    const weeks = groupByLessonWeek(shown, (s) => isLessonSession(s, lessons), weekday, now).slice(0, WEEKS_SHOWN).reverse()
    const since = weeks[0]?.start ?? practiceDayKey(now)
    const practice = shown.filter((s) => !isLessonSession(s, lessons) && practiceDayKey(s.startedAt) >= since)
    const days = practice.map((s) => practiceDayKey(s.startedAt))
    const byPiece = minutesByPiece(practice.map((s) => ({ ...s, pieceIds: piecesOf(s, lessons).filter((id) => !members || members.has(id)) })))
    return { weeks, since, practice, days, byPiece }
  }, [sessions, lessons, members, weekday, now])

  if (error) return <div className="path"><p className="p-error">{error}</p></div>
  if (!overview || !stats) return <div className="path"><p className="p-muted">Loading stats…</p></div>

  const { weeks, since, days, byPiece } = stats
  const current = weeks.at(-1)
  const totalMinutes = [...byPiece.values()].reduce((a, b) => a + b, 0)
  const lessonDay = nextLessonDate(now, weekday)

  // Best weeks and the longest stretch with no home practice, in words.
  const past = weeks.slice(0, -1)
  const best = Math.max(0, ...past.map((w) => w.practiceDays))
  const bestWeeks = best > 0 ? past.filter((w) => w.practiceDays === best) : []
  let gap = { len: 0, from: 0, to: 0 }
  for (let i = 0, run = 0; i < past.length; i++) {
    run = past[i].practiceDays === 0 ? run + 1 : 0
    if (run > gap.len) gap = { len: run, from: past[i - run + 1].start, to: past[i].end }
  }
  const lessonWord = weekday !== undefined ? 'lesson' : 'week'
  const story = [
    bestWeeks.length > 0
      ? `Your best ${bestWeeks.length === 1 ? 'week' : `${bestWeeks.length} weeks`} (${best} day${best === 1 ? '' : 's'}) led into the ${bestWeeks.map((w) => dayMonth(w.end)).join(' and ')} ${lessonWord}${bestWeeks.length === 1 ? '' : 's'}.`
      : undefined,
    gap.len >= 2 ? `The ${gap.len} weeks from ${dayMonth(gap.from)} to ${dayMonth(gap.to)} had no home practice.` : undefined,
  ]
    .filter(Boolean)
    .join(' ')

  const tiles = [
    { value: String(new Set(days).size), label: `practice days since ${dayMonth(since)}` },
    { value: formatMinutes(totalMinutes), label: 'practised at home' },
    { value: `${longestRun(days)} day${longestRun(days) === 1 ? '' : 's'}`, label: 'longest run in a row' },
    {
      value: String(current?.practiceDays ?? 0),
      label: lessonDay !== undefined ? `days so far before ${shortDate(lessonDay)}` : 'days so far this week',
    },
  ]

  return (
    <div className="path">
      <div className="p-header">
        <h1 className="p-h1">Stats</h1>
        <CollectionFilter collections={overview.collections} value={filter} onChange={setFilter} />
      </div>

      <section className="p-card t-card" aria-labelledby="days-title">
        <div>
          <h2 id="days-title" className="t-title">
            {goalHeadline(weeks)}
          </h2>
          <p className="p-muted t-sub">
            Days practised at home in each week before {weekday !== undefined ? `a ${WEEKDAY_NAMES[weekday]} lesson` : 'Sunday'}. The dashed line is {GOAL_DAYS} days.
          </p>
        </div>
        <DaysChart weeks={weeks} lessonDaySet={weekday !== undefined} />
        {story && <p className="t-story">{story}</p>}
      </section>

      <div className="t-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="p-card t-tile">
            <p className="t-tile-value">{t.value}</p>
            <p className="p-muted t-tile-label">{t.label}</p>
          </div>
        ))}
      </div>

      <PieceMinutes byPiece={byPiece} total={totalMinutes} since={since} collections={overview.collections} titles={new Map(overview.pieces.map((p) => [p.id, p.title]))} />
    </div>
  )
}

function DaysChart({ weeks, lessonDaySet }: { weeks: { end: number; practiceDays: number; practiceMinutes: number }[]; lessonDaySet: boolean }) {
  const px = CHART_PX / 7
  // On a phone the chart scrolls sideways; start at the recent end.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [weeks.length])
  return (
    <div className="t-chart-scroll" ref={scrollRef}>
      <div className="t-chart">
        <div className="t-chart-plot">
          <div className="t-goal" aria-hidden="true" style={{ bottom: Math.round(GOAL_DAYS * px) + 1 }} />
          <span className="t-goal-label" aria-hidden="true" style={{ bottom: Math.round(GOAL_DAYS * px) + 4 }}>
            {GOAL_DAYS} days
          </span>
          <ul className="t-bars" aria-label="Practice days per week">
            {weeks.map((w) => (
              <li key={w.end} title={`Week to ${lessonDaySet ? 'lesson ' : ''}${shortDate(w.end)}: ${w.practiceDays} days, ${formatMinutes(w.practiceMinutes)}`}>
                <span className="t-bar-value">{w.practiceDays}</span>
                <span
                  className={`t-bar${w.practiceDays >= GOAL_DAYS ? ' t-bar-goal' : w.practiceDays > 0 ? ' t-bar-some' : ''}`}
                  style={{ height: w.practiceDays === 0 ? 3 : Math.round(w.practiceDays * px) }}
                />
              </li>
            ))}
          </ul>
        </div>
        <div className="t-axis" aria-hidden="true">
          {weeks.map((w, i) => (
            <span key={w.end}>{(weeks.length - 1 - i) % 2 === 0 ? dayMonth(w.end) : ''}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function PieceMinutes({
  byPiece,
  total,
  since,
  collections,
  titles,
}: {
  byPiece: Map<string, number>
  total: number
  since: number
  collections: Collection[]
  titles: Map<string, string>
}) {
  if (total === 0) {
    return (
      <section className="p-card t-card">
        <h2 className="t-title-small">Minutes by piece</h2>
        <p className="p-muted">No home practice in these weeks yet.</p>
      </section>
    )
  }
  // Each piece under its first collection (exam sets first), the rest under Other.
  const ordered = [...collections].sort((a, b) => Number(b.kind === 'exam') - Number(a.kind === 'exam'))
  const groups = new Map<string, { name: string; exam: boolean; rows: { name: string; minutes: number }[] }>()
  for (const [pieceId, minutes] of byPiece) {
    if (minutes < 0.5) continue
    const c = ordered.find((x) => x.pieces.some((p) => p.pieceId === pieceId))
    const key = c?.id ?? 'other'
    const group = groups.get(key) ?? { name: c ? shortCollectionName(c) : 'Other', exam: c?.kind === 'exam', rows: [] }
    group.rows.push({ name: pieceId ? (titles.get(pieceId) ?? 'Deleted piece') : 'Other practice', minutes })
    groups.set(key, group)
  }
  const list = [...groups.values()]
    .map((g) => ({ ...g, total: g.rows.reduce((a, r) => a + r.minutes, 0), rows: g.rows.sort((a, b) => b.minutes - a.minutes) }))
    .sort((a, b) => b.total - a.total)
  const max = Math.max(...list.flatMap((g) => g.rows.map((r) => r.minutes)))
  const top = list[0]
  const headline =
    list.length > 1 && top.name !== 'Other'
      ? `${shareInWords(top.total / total)} of home practice went to ${top.exam ? 'exam pieces' : `${top.name} pieces`}`
      : 'Minutes by piece'

  return (
    <section className="p-card t-card" aria-labelledby="time-title">
      <div>
        <h2 id="time-title" className="t-title-small">
          {headline}
        </h2>
        <p className="p-muted t-sub">Minutes by piece since {dayMonth(since)}, grouped by collection.</p>
      </div>
      {list.map((g) => (
        <div key={g.name} className="t-group">
          <p className="t-group-name">
            {g.name} · {Math.round(g.total)} min
          </p>
          {g.rows.map((r) => (
            <div key={r.name} className="t-row">
              <span className="t-row-name">{r.name}</span>
              <span className="t-row-bar">
                <span style={{ width: `${Math.max(2, (r.minutes / max) * 100)}%` }} />
                <span className="t-row-min">{Math.round(r.minutes)} min</span>
              </span>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}

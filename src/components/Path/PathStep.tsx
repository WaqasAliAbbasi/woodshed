import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { timingQuality } from '../../lib/coach/suggestNextStep'
import type { Attempt } from '../../lib/db/db'
import { resolvePathSection } from '../../lib/db/pathRepo'
import { advanceCursorToMeasure, getStaffCount } from '../../lib/musicxml/buildExpectedTimeline'
import { rangeKey } from '../../lib/musicxml/drawRange'
import type { MeasureRange } from '../../lib/musicxml/types'
import { buildDailyPlan } from '../../lib/path/buildDailyPlan'
import { describeItem, type PathItem, type PiecePath } from '../../lib/path/nextStep'
import { nudgeFor, type Nudge } from '../../lib/path/nudgeFor'
import { isNotesPass, isReadyAttempt } from '../../lib/path/rungProgress'
import { firstHalf, settingsFor, weakerHand, type StepRequest, type StepSettings } from '../../lib/path/stepSettings'
import { tenPercentSlower } from '../../lib/path/tempo'
import type { PathAttempt } from '../../lib/path/types'
import { navigate } from '../../lib/router'
import { SESSION_GAP_MS } from '../../lib/sessions'
import { AppLink, PracticeShell } from '../AppShell/AppShell'
import { InputSourceSelector } from '../InputSourceSelector/InputSourceSelector'
import type { UseMidiInputResult } from '../InputSourceSelector/useMidiInput'
import { usePracticeEngine } from '../PracticeSession/usePracticeEngine'
import { ScoreViewer, type MeasureProgressStatus } from '../ScoreViewer/ScoreViewer'
import { finishHref, freePracticeHref, overviewHref, parseItemParam } from './links'
import { markStepDone, getBudget } from './planProgress'
import { ArrowIcon, ChunkStrip, WholePieceLock } from './PieceOverview'
import { usePiecePath } from './usePiecePath'
import './path.css'

/** Nudges already shown, per rung, with when — "at most once per rung per session". In memory: a reload is a fresh look. */
const shownNudges = new Map<string, number>()

/** Start of the practice session `now` falls in, by the same 20-minute gap rule Sessions use. */
function sessionStart(attempts: PathAttempt[], now: number): number {
  let start = now
  for (const a of [...attempts].sort((x, y) => y.timestamp - x.timestamp)) {
    if (start - a.timestamp > SESSION_GAP_MS) break
    start = a.timestamp - (a.durationMs ?? 0)
  }
  return start
}

/** The step the path (or the URL) asks for, before any offer the student took on this screen. */
function baseRequest(path: PiecePath, review: PathItem | 'whole' | undefined): StepRequest | undefined {
  if (review) {
    if (review === 'whole') {
      return path.chunks.length === 1 ? { kind: 'review', item: { kind: 'chunk', idx: 0 } } : { kind: 'review', item: { kind: 'join', k: path.chunks.length } }
    }
    return { kind: 'review', item: review }
  }
  const next = path.next
  if (next.kind === 'chunk') return { kind: 'chunk', idx: next.idx, rung: next.rung }
  if (next.kind === 'join') return { kind: 'join', k: next.k }
  if (next.kind === 'seam') return { kind: 'seam', k: next.k }
  // Complete: keep the whole piece warm.
  return baseRequest(path, 'whole')
}

/** Index of the chunk a request's sections hang off (a join's is chunk k). */
function chunkIdxOf(request: StepRequest): number {
  switch (request.kind) {
    case 'join':
    case 'seam':
      return request.k - 1
    case 'review':
      return request.item.kind === 'chunk' ? request.item.idx : request.item.k - 1
    default:
      return request.idx
  }
}

function sameSection(settings: StepSettings) {
  return (s: { chunkId?: string; rung?: string; startMeasure: number; endMeasure: number; handFilter?: string; mode?: string }) =>
    s.chunkId === settings.chunkId &&
    s.rung === settings.rung &&
    s.startMeasure === settings.range.startMeasure &&
    s.endMeasure === settings.range.endMeasure &&
    (s.handFilter ?? 'both') === settings.handFilter &&
    (s.mode ?? 'metronome') === settings.mode
}

function passes(settings: StepSettings, attempt: PathAttempt): boolean {
  return settings.mode === 'notes' ? !attempt.aborted && isNotesPass(attempt.aggregate) : isReadyAttempt(attempt)
}

/** "Notes · both hands ✓ › Metronome › Build tempo › Ready" for a chunk (`Rung` artboard). */
function Ladder({ path, request }: { path: PiecePath; request: StepRequest }) {
  if (request.kind === 'chunk' || request.kind === 'notes-hand' || request.kind === 'drill') {
    const p = path.chunks[request.idx].progress
    const nowRung = request.kind === 'chunk' ? request.rung : request.kind === 'notes-hand' ? 'hand' : 'drill'
    const rungs = [
      {
        label: nowRung === 'hand' ? 'Notes · one hand' : p.rung1.passed ? 'Notes · one hand ✓' : 'Notes · one hand · skipped',
        state: nowRung === 'hand' ? 'now' : p.rung1.passed ? 'done' : 'skip',
      },
      { label: p.rung2.passed ? 'Notes · both hands ✓' : 'Notes · both hands', state: nowRung === 'notes' ? 'now' : p.rung2.passed ? 'done' : 'todo' },
      { label: p.rung3.passed ? 'Metronome ✓' : 'Metronome', state: nowRung === 'metronome' ? 'now' : p.rung3.passed ? 'done' : 'todo' },
      {
        label: p.rung4.skipped ? 'Build tempo · not needed' : p.rung4.passed ? 'Build tempo ✓' : 'Build tempo',
        state: nowRung === 'tempo' ? 'now' : p.rung4.skipped ? 'skip' : p.rung4.passed ? 'done' : 'todo',
      },
      { label: p.ready ? 'Ready ✓' : 'Ready', state: p.ready ? 'done' : 'todo' },
    ]
    return (
      <ol className="p-ladder" aria-label="Rungs for this chunk">
        {rungs.map((r, i) => (
          <li key={r.label}>
            <span className={`p-rung p-rung-${r.state}`} aria-current={r.state === 'now' ? 'step' : undefined}>
              {r.label}
            </span>
            {i < rungs.length - 1 && <Chevron />}
          </li>
        ))}
      </ol>
    )
  }
  return null
}

function Chevron() {
  return (
    <svg className="p-ladder-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function PlayIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  )
}

function CheckMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

function SpeakerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9.5v5h4l5 4v-13l-5 4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  )
}

function stepTitle(path: PiecePath, request: StepRequest): string {
  const n = path.chunks.length
  switch (request.kind) {
    case 'join':
      return request.k === n ? 'Whole piece · run-through' : `Join 1–${request.k}`
    case 'seam':
      return `Seam drill ${request.k - 1}–${request.k}`
    case 'review':
      return `${describeItem(request.item, n).replace(/^./, (c) => c.toUpperCase())} · one run`
    default:
      return `Chunk ${request.idx + 1} of ${n}`
  }
}

function resultLine(settings: StepSettings, a: Attempt): string {
  const agg = a.aggregate
  if (agg.expected === 0) return 'Nothing to play here with that hand.'
  const wrong = `${agg.extra} wrong note${agg.extra === 1 ? '' : 's'}`
  if (settings.mode === 'notes') return `${wrong} · ${agg.correct} of ${agg.expected} notes`
  return `${wrong} · pitch ${Math.round(agg.pitchAccuracy * 100)}% · rhythm ${Math.round(timingQuality(agg) * 100)}%`
}

/**
 * One path step at the piano (`Rung`, `AfterAttempt`, `Nudge` and `JoinLock`
 * artboards): what to play and at what tempo, the Play button, and — after
 * each try — exactly one next decision. Every value is re-derived from the
 * attempts after each try, so the screen never holds path state of its own,
 * only which offer the student just took.
 */
export function PathStep({ pieceId, midi, search }: { pieceId: string; midi: UseMidiInputResult; search: URLSearchParams }) {
  const loaded = usePiecePath(pieceId)
  if (loaded.error || !loaded.data || !loaded.derived) {
    return (
      <PracticeShell where={null} right={null}>
        <div className="path">{loaded.error ? <p className="p-error">{loaded.error}</p> : <p className="p-muted">Loading the piece…</p>}</div>
      </PracticeShell>
    )
  }
  return <StepScreen key={loaded.data.piece.id} data={loaded.data} derived={loaded.derived} now={loaded.now} addAttempt={loaded.addAttempt} midi={midi} search={search} />
}

type Loaded = ReturnType<typeof usePiecePath>
type Data = NonNullable<Loaded['data']>
type Derived = NonNullable<Loaded['derived']>

/** What the screen is showing: the step itself, a try in progress, or one of the three after-a-try states. */
type View = 'ready' | 'live' | 'result' | 'nudge' | 'milestone'

/** The join a try just passed, if it passed one — measured against the path just before the try. */
function newlyJoinedK(path: PiecePath, before: PiecePath | undefined, played: StepSettings | undefined): number | undefined {
  if (played?.rung !== 'join' || !before) return undefined
  return path.joins.find((j) => j.passed && !before.joins.find((b) => b.k === j.k)?.passed)?.k
}

function StepScreen({
  data,
  derived,
  now,
  addAttempt,
  midi,
  search,
}: {
  data: Data
  derived: Derived
  now: number
  addAttempt: Loaded['addAttempt']
  midi: UseMidiInputResult
  search: URLSearchParams
}) {
  const { piece } = data
  const { path, target } = derived
  const review = parseItemParam(search.get('review'))
  const planStepKey = search.get('step') ?? undefined
  const isWin = search.get('win') === '1'

  const [osmd, setOsmd] = useState<OpenSheetMusicDisplay | undefined>(undefined)
  // An offer taken on this screen (one hand first, shorter, slower), until it's done its job.
  const [override, setOverride] = useState<StepRequest | undefined>(undefined)
  const [nudge, setNudge] = useState<Nudge | undefined>(undefined)
  const [countAloud, setCountAloud] = useState(false)
  const [triesThisVisit, setTriesThisVisit] = useState(0)
  // The path just before the latest try — what a milestone is measured against.
  const [before, setBefore] = useState<PiecePath | undefined>(undefined)
  // The settings the latest try was played with.
  const [played, setPlayed] = useState<StepSettings | undefined>(undefined)
  // Which measures the score currently draws (see ScoreViewer's `focus`). A
  // try can only start once its own range is drawn: the engine builds its
  // timeline from the drawn score.
  const [drawnKey, setDrawnKey] = useState<string | undefined>(undefined)
  // A Play pressed while the score still showed another range — it starts as soon as that range is drawn.
  const [pendingPlay, setPendingPlay] = useState<StepSettings | undefined>(undefined)

  const request = override ?? baseRequest(path, review)
  const sectionRung = useMemo(() => new Map(data.sections.map((s) => [s.id, { chunkId: s.chunkId, rung: s.rung }])), [data.sections])
  const settings = request
    ? settingsFor(request, { path, attempts: data.attempts, rung3Passes: derived.rung3Passes, targetTempoBpm: target, now, sectionRung })
    : undefined

  // Read from callbacks that outlive the render they were made in.
  const latest = useRef({ data, played, override, planStepKey, review, isWin })
  useLayoutEffect(() => {
    latest.current = { data, played, override, planStepKey, review, isWin }
  })

  const resolveSectionId = useCallback(async () => (await resolvePathSection(piece.id, latest.current.played!)).id, [piece.id])

  const onAttemptRecorded = useCallback(
    (sectionId: string, attempt: Attempt) => {
      const { data, played, override, planStepKey, review, isWin } = latest.current
      setTriesThisVisit((n) => n + 1)
      void addAttempt(attempt)
      if (!played) return
      if ((review || isWin) && planStepKey && !attempt.aborted) markStepDone(planStepKey)

      // An offer has done its job: "slower" was for one try; a shorter or one-hand drill once it's clean.
      if (override && ('slowerBpm' in override || ((override.kind === 'drill' || override.kind === 'notes-hand') && passes(played, attempt)))) {
        setOverride(undefined)
      }

      // A guardrail, at most once per rung per session.
      const rungAttempts = [...data.attempts.filter((a) => a.sectionId === sectionId), attempt].sort((a, b) => a.timestamp - b.timestamp)
      const key = `${played.chunkId}:${played.rung}`
      const start = sessionStart([...data.attempts, attempt], Date.now())
      const found = nudgeFor({
        attempts: rungAttempts,
        sessionStart: start,
        alreadyShown: (shownNudges.get(key) ?? -Infinity) >= start,
        mode: played.mode,
        range: played.range,
        tempoBpm: played.tempo.bpm,
      })
      if (found) shownNudges.set(key, Date.now())
      setNudge(found)
    },
    [addAttempt, setTriesThisVisit, setOverride, setNudge],
  )

  const engine = usePracticeEngine({ osmd, pieceId: piece.id, midi, resolveSectionId, onAttemptRecorded })
  const { state } = engine
  const idle = state.status === 'PieceLoaded' || state.status === 'SectionConfigured'
  const complete = state.status === 'AttemptComplete'

  const view: View =
    engine.isLive || state.status === 'AttemptScoring'
      ? 'live'
      : complete && played
        ? newlyJoinedK(path, before, played) !== undefined
          ? 'milestone'
          : nudge
            ? 'nudge'
            : 'result'
        : 'ready'

  // The attempt scrolled the page to follow the cursor; bring the result
  // (and the next decision) back into view.
  useEffect(() => {
    if (complete) window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [complete])

  // While idle, park the cursor where the next try starts (again after each
  // re-draw). No scroll: the decision (tempo, Play) must stay in view.
  const startMeasure = settings?.range.startMeasure
  useEffect(() => {
    if (!osmd || !idle || startMeasure === undefined) return
    advanceCursorToMeasure(osmd, startMeasure)
    osmd.cursor.show()
  }, [osmd, idle, startMeasure, drawnKey])

  const begin = (s: StepSettings) => {
    setPlayed(s)
    latest.current.played = s
    setBefore(path)
    setNudge(undefined)
    void engine.begin({ range: s.range, tempoBpm: s.tempo.bpm, handFilter: s.handFilter, mode: s.mode })
  }
  const beginRef = useRef(begin)
  useLayoutEffect(() => {
    beginRef.current = begin
  })

  const play = (s: StepSettings) => {
    if (rangeKey(s.range) === drawnKey) begin(s)
    else setPendingPlay(s)
  }

  useEffect(() => {
    if (!pendingPlay || rangeKey(pendingPlay.range) !== drawnKey) return
    // oxlint-disable-next-line react/set-state-in-effect -- the score (an external system) just finished drawing the range this Play was waiting for.
    setPendingPlay(undefined)
    beginRef.current(pendingPlay)
  }, [pendingPlay, drawnKey])

  const backToPlan = () => {
    if (planStepKey && triesThisVisit > 0) markStepDone(planStepKey)
    navigate('/')
  }

  // The score shows the range being played, the one just played (with its
  // notes coloured) after a try, or the next one while a Play waits for it.
  const showing = complete ? played : settings
  const focus = pendingPlay?.range ?? showing?.range

  const body = (() => {
    if (!settings || !request) return <p>Nothing to play here yet.</p>
    if (view === 'live') return <LiveRow engine={engine} played={played} countAloud={countAloud} />
    if (view === 'milestone') {
      return (
        <Milestone
          path={path}
          joinK={newlyJoinedK(path, before, played)!}
          target={target}
          pieceId={piece.id}
          settings={settings}
          midiConnected={midi.connected}
          onContinue={() => play(settings)}
          onPlan={backToPlan}
        />
      )
    }
    if (view === 'nudge' && nudge && played) {
      return (
        <NudgeView
          nudge={nudge}
          played={played}
          request={request}
          onTake={(r, aloud) => {
            setNudge(undefined)
            setCountAloud(aloud)
            if (r) setOverride(r)
          }}
        />
      )
    }
    if (view === 'result' && played) {
      return <ResultView {...{ data, derived, settings, played, midi, review, isWin, play, backToPlan }} />
    }
    if (!osmd) return <p className="p-muted">Loading the score…</p>
    return (
      <ReadyView
        {...{ data, path, request, settings, midi, engine, override, countAloud, play }}
        twoStaves={getStaffCount(osmd) > 1}
        onOverride={setOverride}
      />
    )
  })()

  return (
    <Frame
      data={data}
      derived={derived}
      now={now}
      view={view}
      settings={showing}
      request={request}
      midi={midi}
      focus={focus}
      onOsmd={setOsmd}
      onDrawn={setDrawnKey}
      frozen={!idle && !pendingPlay}
      editable={idle}
    >
      {body}
    </Frame>
  )
}

/** Shared chrome: the slim practice bar, the rung pills, the chunk's score, then the decision for this view. */
function Frame({
  data,
  derived,
  now,
  view,
  settings,
  request,
  midi,
  focus,
  onOsmd,
  onDrawn,
  frozen,
  editable,
  children,
}: {
  data: Data
  derived: Derived
  now: number
  view: View
  settings: StepSettings | undefined
  request: StepRequest | undefined
  midi: UseMidiInputResult
  focus: MeasureRange | undefined
  onOsmd: (osmd: OpenSheetMusicDisplay | undefined) => void
  onDrawn: (focusKey: string | undefined) => void
  frozen: boolean
  editable: boolean
  children: React.ReactNode
}) {
  const { piece } = data
  const { path } = derived
  const plan = useMemo(() => buildDailyPlan(derived.library.plan, now, getBudget()), [derived.library.plan, now])
  const measureStatus = useMemo(() => {
    const map = new Map<number, MeasureProgressStatus>()
    for (const c of path.chunks) {
      if (!c.progress.ready) continue
      for (let m = c.chunk.startMeasure; m <= c.chunk.endMeasure; m++) map.set(m, 'ready')
    }
    return map
  }, [path])

  const where = (
    <>
      <AppLink href={overviewHref(piece.id)} className="shell-where-piece">
        {piece.title}
      </AppLink>
      {request && settings && (
        <>
          {' · '}
          <strong>{stepTitle(path, request)}</strong> · m. {settings.range.startMeasure}–{settings.range.endMeasure}
        </>
      )}
    </>
  )
  const right = (
    <>
      <button type="button" className="shell-link" onClick={() => navigate(finishHref(plan))}>
        Finish now
      </button>
      <AppLink href={freePracticeHref(piece.id)} className="shell-link">
        Free practice
      </AppLink>
      <InputSourceSelector midi={midi} />
    </>
  )

  const scoreHidden = view === 'nudge' || view === 'milestone'
  return (
    <PracticeShell where={where} right={right}>
      <div className={`path p-practice p-practice-${view}`}>
        {(view === 'ready' || view === 'live') && request && <Ladder path={path} request={request} />}
        <section
          className={`p-score${scoreHidden ? ' p-score-hidden' : ''}`}
          aria-hidden={scoreHidden || undefined}
          aria-label={focus ? `Measures ${focus.startMeasure} to ${focus.endMeasure}` : 'Score'}
        >
          {view === 'result' && <p className="p-eyebrow">That try, note by note</p>}
          <ScoreViewer
            musicXml={piece.musicXml}
            onReady={onOsmd}
            range={settings?.range}
            clickable={editable}
            onMeasureClick={noop}
            handFilter={settings?.handFilter ?? 'both'}
            measureStatus={measureStatus}
            frozen={frozen}
            focus={focus}
            onDrawn={onDrawn}
          />
        </section>
        {children}
      </div>
    </PracticeShell>
  )
}

function noop() {}

type Engine = ReturnType<typeof usePracticeEngine>

/** During a try: the same row as the tempo panel and Play, with the beat and Stop in their places. */
function LiveRow({ engine, played, countAloud }: { engine: Engine; played: StepSettings | undefined; countAloud: boolean }) {
  const { state } = engine
  return (
    <div className="p-try-row">
      <section className="p-card p-tempo-panel" aria-live="polite">
        <div>
          <p className="p-eyebrow">{state.status === 'CountingIn' ? 'Count-in' : state.status === 'AttemptScoring' ? 'Scoring' : 'Playing'}</p>
          {played?.mode === 'notes' ? (
            <p className="p-tempo-big p-tempo-words">Take your time</p>
          ) : (
            <p className="p-tempo-big">
              {played?.tempo.bpm}
              <small> bpm</small>
            </p>
          )}
          {countAloud && played?.mode === 'metronome' && <p className="p-muted p-small">Count the beats out loud</p>}
        </div>
        {played?.mode === 'metronome' && (
          <div className="p-cells p-beats" aria-hidden="true">
            {Array.from({ length: engine.beatsPerMeasure }, (_, i) => (
              <span key={i} className={engine.isLive && i === engine.currentBeat ? 'p-cell-now-beat' : undefined} />
            ))}
          </div>
        )}
      </section>
      <div className="p-play">
        {played?.runThrough ? (
          <p className="p-muted p-small" style={{ textAlign: 'center' }}>
            Run-through: play to the end, whatever happens.
          </p>
        ) : (
          state.status !== 'AttemptScoring' && (
            <button type="button" className="p-btn p-btn-stop" onClick={() => engine.dispatch({ type: 'stop' })}>
              Stop
            </button>
          )
        )}
      </div>
    </div>
  )
}

/** The result of a try, as its own state (`AfterAttempt` artboard): how it went, then the one next decision. */
function ResultView({
  data,
  derived,
  settings,
  played,
  midi,
  review,
  isWin,
  play,
  backToPlan,
}: {
  data: Data
  derived: Derived
  settings: StepSettings
  played: StepSettings
  midi: UseMidiInputResult
  review: PathItem | 'whole' | undefined
  isWin: boolean
  play: (s: StepSettings) => void
  backToPlan: () => void
}) {
  const { target } = derived
  const latestAttempt = [...data.attempts].sort((a, b) => b.timestamp - a.timestamp)[0]
  const passed = latestAttempt ? passes(played, latestAttempt) : false
  const matching = new Set(data.sections.filter(sameSection(played)).map((s) => s.id))
  const rungAttempts = data.attempts.filter((a) => matching.has(a.sectionId)).sort((a, b) => a.timestamp - b.timestamp)

  if (review || isWin) {
    return (
      <>
        <ResultHeader played={played} attempt={latestAttempt} passed={passed} />
        <section className="p-card p-card-accent p-next" aria-label="What's next">
          <div className="p-next-text">
            <p className="p-eyebrow p-eyebrow-accent">{isWin ? 'Today' : 'Next'}</p>
            <p className="p-next-title">{isWin ? 'Ending on that' : 'Back to the plan'}</p>
          </div>
          <button type="button" className="p-btn p-btn-primary p-btn-next" onClick={() => navigate(isWin ? '/done' : '/')}>
            {isWin ? 'Finish' : 'Back to plan'}
          </button>
        </section>
        <div className="p-after-row">
          <span />
          <button type="button" className="p-btn" disabled={!midi.connected} onClick={() => play(played)}>
            Once more
          </button>
        </div>
      </>
    )
  }

  const nextIsNew = settings.label !== played.label || settings.rung !== played.rung
  const headline = settings.endToday
    ? `Stay at ${settings.tempo.bpm} today`
    : nextIsNew
      ? `Next: ${settings.label}${settings.mode === 'metronome' ? `, ${settings.tempo.bpm} bpm` : ''}`
      : settings.mode === 'notes'
        ? 'Same again, no metronome'
        : `${settings.tempo.bpm} bpm${settings.tempo.bpm >= target ? ', your target' : ''}`

  return (
    <>
      <ResultHeader played={played} attempt={latestAttempt} passed={passed} />
      <section className="p-card p-card-accent p-next" aria-label="What's next">
        <div className="p-next-text">
          <p className="p-eyebrow p-eyebrow-accent">{settings.endToday ? 'Today' : 'Next try'}</p>
          <p className="p-next-title">{headline}</p>
          <p className="p-muted p-small">
            {settings.endToday
              ? "It's solid there. Three misses in a row today: come back to the faster tempo tomorrow."
              : `${settings.tempo.reason}. ${settings.goal}.`}
          </p>
        </div>
        {settings.endToday ? (
          <button type="button" className="p-btn p-btn-primary p-btn-next" onClick={backToPlan}>
            Back to plan
          </button>
        ) : (
          <button type="button" className="p-btn p-btn-primary p-btn-next" disabled={!midi.connected} onClick={() => play(settings)}>
            <PlayIcon size={26} />
            {settings.mode === 'notes' ? 'Play' : `Play at ${settings.tempo.bpm}`}
          </button>
        )}
      </section>
      <div className="p-after-row">
        <div>
          <p className="p-muted p-small" style={{ marginBottom: 8 }}>
            Tries at this rung
          </p>
          <Tries settings={played} attempts={rungAttempts} />
        </div>
        <div className="p-actions">
          {nextIsNew && (
            <button type="button" className="p-btn" disabled={!midi.connected} onClick={() => play(played)}>
              Again{played.mode === 'metronome' ? ` at ${played.tempo.bpm}` : ''}
            </button>
          )}
          {!settings.endToday && (
            <button type="button" className="p-btn" onClick={backToPlan}>
              Back to plan
            </button>
          )}
        </div>
      </div>
    </>
  )
}

/** Before a try (`Rung` artboard): the tempo panel and Play side by side, under the score. */
function ReadyView({
  data,
  path,
  request,
  settings,
  midi,
  engine,
  override,
  countAloud,
  twoStaves,
  play,
  onOverride,
}: {
  data: Data
  path: PiecePath
  request: StepRequest
  settings: StepSettings
  midi: UseMidiInputResult
  engine: Engine
  override: StepRequest | undefined
  countAloud: boolean
  twoStaves: boolean
  play: (s: StepSettings) => void
  onOverride: (r: StepRequest | undefined) => void
}) {
  const matching = new Set(data.sections.filter(sameSection(settings)).map((s) => s.id))
  const rungAttempts = data.attempts.filter((a) => matching.has(a.sectionId)).sort((a, b) => a.timestamp - b.timestamp)
  const offer = stuckOffer(path, request, settings, data.attempts, data.sections)

  return (
    <>
      {offer && !override && (
        <section className="p-card p-card-accent p-offer">
          <div style={{ flex: '999 1 320px' }}>
            <p className="p-eyebrow p-eyebrow-accent">Three tries without a pass today</p>
            <p>{offer.why}</p>
          </div>
          <button type="button" className="p-btn" style={{ flex: '1 1 220px' }} onClick={() => onOverride(offer.request)}>
            {offer.label}
          </button>
        </section>
      )}
      <div className="p-try-row">
        <section className="p-card p-tempo-panel" aria-label="Tempo for this try">
          <div>
            <p className="p-eyebrow">This try</p>
            {settings.mode === 'metronome' ? (
              <p className="p-tempo-big">
                {settings.tempo.bpm}
                <small> bpm</small>
              </p>
            ) : (
              <p className="p-tempo-big p-tempo-words">No click</p>
            )}
            <p className="p-muted p-small" style={{ marginTop: 6 }}>
              {settings.mode === 'metronome' ? settings.tempo.reason : 'Take your time'}
            </p>
          </div>
          <div className="p-tempo-goal">
            <p>
              <strong>Goal:</strong> {settings.goal}
            </p>
            {settings.mode === 'metronome' && <p className="p-muted p-small">Ready = pitch 95% and rhythm 85% or better</p>}
            {countAloud && settings.mode === 'metronome' && <p className="p-banner">Count the beats out loud as you play.</p>}
            <Tries settings={settings} attempts={rungAttempts} />
          </div>
        </section>
        <div className="p-play">
          <button type="button" className="p-btn p-btn-primary p-btn-huge" disabled={!midi.connected} onClick={() => play(settings)}>
            <PlayIcon />
            Play
          </button>
          <p className="p-muted p-small" style={{ textAlign: 'center' }}>
            {!midi.connected
              ? 'Connect a MIDI keyboard to play.'
              : settings.runThrough
                ? 'One bar count-in · run-through, no stopping'
                : settings.mode === 'metronome'
                  ? 'One bar count-in · stop any time'
                  : 'Starts on your first note · stop any time'}
          </p>
          <div className="p-play-secondary">
            {engine.isPlayingBack ? (
              <button type="button" className="p-btn p-btn-small" onClick={engine.stopPlayback}>
                Stop listening
              </button>
            ) : (
              <button
                type="button"
                className="p-btn p-btn-small"
                onClick={() => engine.playRange({ range: settings.range, tempoBpm: settings.tempo.bpm, handFilter: settings.handFilter, mode: settings.mode })}
              >
                <SpeakerIcon />
                Hear it{settings.mode === 'metronome' ? ` at ${settings.tempo.bpm}` : ''}
              </button>
            )}
            {request.kind === 'chunk' && request.rung === 'notes' && twoStaves && (
              <button type="button" className="p-btn p-btn-small" onClick={() => onOverride({ kind: 'notes-hand', idx: request.idx, hand: weakerHand(rungAttempts) })}>
                One hand first
              </button>
            )}
            {override && (
              <button type="button" className="p-btn p-btn-small" onClick={() => onOverride(undefined)}>
                {override.kind === 'drill' || override.kind === 'notes-hand' ? 'Back to the whole chunk' : 'Back to the usual tempo'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/** The way round a rung that's been missed three times today (docs/learning-path.md, "Rungs"). */
function stuckOffer(
  path: PiecePath,
  request: StepRequest,
  settings: StepSettings,
  attempts: PathAttempt[],
  sections: Data['sections'],
): { why: string; label: string; request: StepRequest } | undefined {
  if (request.kind === 'chunk') {
    const p = path.chunks[request.idx].progress
    if (request.rung === 'notes' && p.rung2.stuck) {
      const ids = new Set(sections.filter((s) => s.chunkId === settings.chunkId && s.rung === 'notes').map((s) => s.id))
      const hand = weakerHand(attempts.filter((a) => ids.has(a.sectionId)))
      return { why: `The ${hand} hand is where most of the wrong notes were. Learn it on its own first.`, label: `${hand === 'left' ? 'Left' : 'Right'} hand alone`, request: { kind: 'notes-hand', idx: request.idx, hand } }
    }
    if (request.rung === 'metronome' && p.rung3.stuck) {
      const bpm = tenPercentSlower(settings.tempo.bpm)
      return { why: 'A little slower usually brings it together. Same chunk.', label: `10% slower: ${bpm} bpm`, request: { ...request, slowerBpm: bpm } }
    }
  }
  if (request.kind === 'notes-hand' && path.chunks[request.idx].progress.rung1.stuck) {
    const half = firstHalf(settings.range)
    return {
      why: 'Half the chunk is plenty for now. Back to the whole of it once this is clean.',
      label: `Measures ${half.startMeasure}–${half.endMeasure} only`,
      request: { kind: 'drill', idx: request.idx, range: half, mode: 'notes', handFilter: request.hand, tempoBpm: settings.tempo.bpm },
    }
  }
  return undefined
}

function Tries({ settings, attempts }: { settings: StepSettings; attempts: PathAttempt[] }) {
  const counted = attempts.filter((a) => !a.aborted && a.aggregate.expected > 0).slice(-6)
  if (counted.length === 0) return null
  return (
    <ul className="p-tries" aria-label="Tries at this rung">
      {counted.map((a, i) => (
        <li key={a.id} className={`${passes(settings, a) ? '' : 'p-try-miss'}${i === counted.length - 1 ? ' p-try-latest' : ''}`}>
          {settings.mode === 'notes' ? `${a.aggregate.extra} wrong` : a.tempoBpm} · {passes(settings, a) ? 'passed' : 'missed'}
        </li>
      ))}
    </ul>
  )
}

function ResultHeader({ played, attempt, passed }: { played: StepSettings; attempt: Attempt | undefined; passed: boolean }) {
  const headline = attempt?.aborted
    ? 'Stopped early'
    : passed
      ? played.mode === 'notes'
        ? 'Passed'
        : `Passed at ${played.tempo.bpm} bpm`
      : played.mode === 'notes'
        ? 'Not yet'
        : `Not yet at ${played.tempo.bpm}`
  return (
    <section aria-label="Result" className="p-result">
      <span className={`p-result-mark${passed ? '' : ' p-result-mark-miss'}`} aria-hidden="true">
        {passed ? <CheckMark size={52} /> : <span className="p-result-dot" />}
      </span>
      <div className="p-result-text">
        <h1 className="p-result-title">{headline}</h1>
        {attempt && <p className="p-muted p-result-detail">{resultLine(played, attempt)}</p>}
      </div>
    </section>
  )
}

/** A guardrail as one choice (`Nudge` artboard) — never a page of stats. */
function NudgeView({ nudge, played, request, onTake }: { nudge: Nudge; played: StepSettings; request: StepRequest; onTake: (r: StepRequest | undefined, countAloud: boolean) => void }) {
  if (nudge.kind === 'quick-stops') {
    const idx = chunkIdxOf(request)
    const shorter: StepRequest = { kind: 'drill', idx, range: nudge.shorter, mode: played.mode, handFilter: played.handFilter, tempoBpm: played.tempo.bpm }
    const slower: StepRequest | undefined =
      nudge.slowerBpm === undefined
        ? undefined
        : request.kind === 'chunk' || request.kind === 'join' || request.kind === 'seam'
          ? { ...request, slowerBpm: nudge.slowerBpm }
          : { kind: 'drill', idx, range: played.range, mode: played.mode, handFilter: played.handFilter, tempoBpm: nudge.slowerBpm }
    return (
      <div className="p-nudge">
        <div>
          <p className="p-eyebrow">Two quick stops in a row</p>
          <h1 className="p-h1">Let's make this smaller</h1>
          <p className="p-muted p-lede">
            Stopping within a few seconds usually means it's a bit too long or too fast right now. Accurate tries teach more than many tries.
          </p>
        </div>
        <div className="p-choices">
          <button type="button" className="p-choice" onClick={() => onTake(shorter, false)}>
            <span className="p-choice-kind">Shorter</span>
            <span className="p-choice-title">
              Measures {nudge.shorter.startMeasure}–{nudge.shorter.endMeasure} only
            </span>
            <span className="p-muted p-small">Back to the whole once this is clean.</span>
          </button>
          {slower && (
            <button type="button" className="p-choice" onClick={() => onTake(slower, false)}>
              <span className="p-choice-kind">Slower</span>
              <span className="p-choice-title">{nudge.slowerBpm} bpm</span>
              <span className="p-muted p-small">10% under this try. Same passage.</span>
            </button>
          )}
        </div>
        <button type="button" className="p-link" style={{ alignSelf: 'flex-start' }} onClick={() => onTake(undefined, false)}>
          Keep going as it is
        </button>
      </div>
    )
  }
  const drift = nudge.drift ? `, mostly ${nudge.drift}` : ''
  return (
    <div className="p-nudge">
      <div>
        <p className="p-eyebrow">Last 3 tries</p>
        <h1 className="p-h1">Right notes, timing drifting</h1>
        <p className="p-muted p-lede">
          Pitch {Math.round(nudge.pitch * 100)}%, rhythm {Math.round(nudge.rhythm * 100)}%{drift}. Going slower won't fix this one: it's the counting, not the speed.
        </p>
      </div>
      <div className="p-choices">
        <button type="button" className="p-choice" onClick={() => onTake(undefined, true)}>
          <span className="p-choice-kind">Try this</span>
          <span className="p-choice-title">Count aloud while you play</span>
          <span className="p-muted p-small">Same tempo. Say the beats out loud, one bar count-in.</span>
        </button>
      </div>
      <button type="button" className="p-link" style={{ alignSelf: 'flex-start' }} onClick={() => onTake(undefined, false)}>
        Keep going as it is
      </button>
    </div>
  )
}

/** A passed join is a milestone (`JoinLock` artboard): the celebration, where it stands across the score, and what's next. */
function Milestone({
  path,
  joinK,
  target,
  pieceId,
  settings,
  midiConnected,
  onContinue,
  onPlan,
}: {
  path: PiecePath
  joinK: number
  target: number
  pieceId: string
  settings: StepSettings
  midiConnected: boolean
  onContinue: () => void
  onPlan: () => void
}) {
  const join = path.joins.find((j) => j.k === joinK)!
  const n = path.chunks.length
  const share = (join.endMeasure - join.startMeasure + 1) / (path.chunks[n - 1].chunk.endMeasure - path.chunks[0].chunk.startMeasure + 1)
  return (
    <>
      <section aria-label="Milestone" className="p-milestone">
        <span className="p-result-mark p-milestone-mark" aria-hidden="true">
          <CheckMark size={34} />
        </span>
        <div style={{ flex: '1 1 400px', minWidth: 0 }}>
          <h1 className="p-milestone-title">{join.whole ? 'The whole piece, ready' : `Joined chunks 1–${joinK}`}</h1>
          <p className="p-milestone-text">
            Measures {join.startMeasure}–{join.endMeasure} straight through at {target} bpm.
            {!join.whole && share > 0.5 ? " That's more than half the piece." : ''}
            {join.whole ? ' Take it to your teacher.' : ''}
          </p>
        </div>
      </section>
      <ChunkStrip path={path} status joinedThrough={join.endMeasure} />
      <div className="p-split p-split-stretch">
        {path.next.kind !== 'complete' ? (
          <section className="p-main p-card p-card-accent p-next-card" aria-label="Next step">
            <div>
              <p className="p-eyebrow p-eyebrow-accent">Next</p>
              <p className="p-next-title">{settings.label}</p>
              <p className="p-muted p-small">
                Measures {settings.range.startMeasure}–{settings.range.endMeasure}. {settings.goal}.
              </p>
            </div>
            <button type="button" className="p-btn p-btn-primary" disabled={!midiConnected} onClick={onContinue}>
              Continue
              <ArrowIcon />
            </button>
          </section>
        ) : (
          <section className="p-main p-next-card">
            <button type="button" className="p-btn p-btn-primary" onClick={onPlan}>
              Back to plan
            </button>
          </section>
        )}
        <div className="p-side">
          <WholePieceLock path={path} pieceId={pieceId} />
        </div>
      </div>
    </>
  )
}

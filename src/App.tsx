import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { HistoryView } from './components/History/HistoryView'
import { InputSourceSelector } from './components/InputSourceSelector/InputSourceSelector'
import { useMidiInput, type UseMidiInputResult } from './components/InputSourceSelector/useMidiInput'
import { AppShell, PracticeShell } from './components/AppShell/AppShell'
import { BiggerScreen } from './components/Path/BiggerScreen'
import { LibraryView } from './components/Path/LibraryView'
import { overviewHref } from './components/Path/links'
import { LogLesson } from './components/Path/LogLesson'
import { SessionEnd } from './components/Path/SessionEnd'
import { TodayPlan } from './components/Path/TodayPlan'
import { SessionsView } from './components/Sessions/SessionsView'
import { StatsView } from './components/Stats/StatsView'
import { TargetTempoChip } from './components/TempoControl/TargetTempoChip'
import { flushOutbox } from './lib/db/attemptsRepo'
import { getPiece, updatePiece, updateTargetTempo } from './lib/db/piecesRepo'
import { getTempoPresets } from './lib/musicxml/buildExpectedTimeline'
import type { Piece } from './lib/db/db'
import { matchPath, useIsPhone, useRoute } from './lib/router'

// These pull in OpenSheetMusicDisplay, by far the heaviest dependency in
// the app, so they're kept out of the initial bundle and only fetched once
// a piece is actually opened.
const PracticeWorkspace = lazy(() =>
  import('./components/PracticeSession/PracticeWorkspace').then((m) => ({ default: m.PracticeWorkspace })),
)
const PieceOverview = lazy(() => import('./components/Path/PieceOverview').then((m) => ({ default: m.PieceOverview })))
const PathStep = lazy(() => import('./components/Path/PathStep').then((m) => ({ default: m.PathStep })))

function RenamableTitle({ piece, onRenamed }: { piece: Piece; onRenamed: (piece: Piece) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(piece.title)

  const commit = async () => {
    const title = draft.trim()
    if (title && title !== piece.title) {
      // The server returns a summary (no musicXml, see piecesRepo.ts) —
      // merge just the fields that changed into the piece already held in
      // memory instead of replacing it wholesale, so the score currently
      // rendered isn't discarded by a rename.
      const updated = await updatePiece(piece.id, { title })
      onRenamed({ ...piece, title: updated.title, updatedAt: updated.updatedAt })
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="app-title-edit">
        <input
          type="text"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={() => void commit()}
        />
        <button type="button" onClick={() => void commit()}>
          Save
        </button>
      </span>
    )
  }

  return (
    <span className="app-title">
      {piece.title}
      <button
        type="button"
        className="app-rename"
        aria-label={`Rename ${piece.title}`}
        onClick={() => {
          setDraft(piece.title)
          setEditing(true)
        }}
      >
        ✎
      </button>
    </span>
  )
}

function RenamableComposer({ piece, onRenamed }: { piece: Piece; onRenamed: (piece: Piece) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(piece.composer ?? '')

  const commit = async () => {
    const composer = draft.trim()
    if (composer !== (piece.composer ?? '')) {
      // Same merge-not-replace approach as RenamableTitle's commit, above.
      const updated = await updatePiece(piece.id, { title: piece.title, composer })
      onRenamed({ ...piece, composer: updated.composer, updatedAt: updated.updatedAt })
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="app-composer-edit">
        <input
          type="text"
          value={draft}
          placeholder="Composer"
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={() => void commit()}
        />
        <button type="button" onClick={() => void commit()}>
          Save
        </button>
      </span>
    )
  }

  return (
    <p className="app-composer">
      {piece.composer}
      <button
        type="button"
        className="app-rename"
        aria-label={piece.composer ? `Edit composer` : 'Add composer'}
        onClick={() => {
          setDraft(piece.composer ?? '')
          setEditing(true)
        }}
      >
        ✎
      </button>
    </p>
  )
}

/**
 * Free practice — the original practice workspace, unchanged: pick any
 * measures, any mode, any tempo. Its attempts are recorded and show in
 * history, but never move the learning path (see resolveSection).
 */
function FreePractice({ pieceId, midi }: { pieceId: string; midi: UseMidiInputResult }) {
  const [piece, setPiece] = useState<Piece | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  // The score's own marked tempo, reported up once PracticeWorkspace has a
  // parsed score. Stands in as the target until the student sets one, and
  // anchors the presets to "full speed" rather than to whatever's dialed in.
  const [scoreTempoBpm, setScoreTempoBpm] = useState<number | undefined>(undefined)
  const [editable, setEditable] = useState(true)

  useEffect(() => {
    let cancelled = false
    getPiece(pieceId)
      .then((loaded) => {
        if (cancelled) return
        if (loaded) setPiece(loaded)
        else setLoadError('That piece no longer exists.')
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [pieceId])

  const targetTempoBpm = piece?.targetTempoBpm ?? scoreTempoBpm
  const tempoPresets = useMemo(() => (scoreTempoBpm === undefined ? undefined : getTempoPresets(scoreTempoBpm)), [scoreTempoBpm])
  const handleScoreTempoResolved = useCallback((bpm: number) => setScoreTempoBpm(bpm), [])
  const handleAttemptRecorded = useCallback(() => setHistoryRefreshKey((k) => k + 1), [])

  const handleTargetTempoChange = useCallback(
    (bpm: number) => {
      if (!piece) return
      // Applied locally first so the dial and the score's shading react at
      // once; the piece row is the durable copy, but a round trip per drag
      // of the slider would make the control feel stuck.
      setPiece({ ...piece, targetTempoBpm: bpm })
      void updateTargetTempo(piece.id, bpm)
    },
    [piece],
  )

  if (loadError) return <div className="banner banner-error">{loadError}</div>
  if (!piece) return <div className="panel">Loading…</div>

  return (
    <>
      <div className="app-header">
        <div className="app-title-block">
          <RenamableTitle piece={piece} onRenamed={setPiece} />
          <RenamableComposer piece={piece} onRenamed={setPiece} />
        </div>
        {targetTempoBpm !== undefined && (
          <TargetTempoChip tempoBpm={targetTempoBpm} presets={tempoPresets} disabled={!editable} onChange={handleTargetTempoChange} />
        )}
        <InputSourceSelector midi={midi} />
      </div>
      <p className="selection-hint" style={{ margin: '0.5rem 0 0' }}>
        Free practice: plays anything, recorded in your history, doesn't move the path.
      </p>

      <Suspense fallback={<div className="panel">Loading practice tools…</div>}>
        <PracticeWorkspace
          piece={piece}
          midi={midi}
          progressRefreshKey={historyRefreshKey}
          onAttemptRecorded={handleAttemptRecorded}
          targetTempoBpm={targetTempoBpm}
          onScoreTempoResolved={handleScoreTempoResolved}
          onEditableChange={setEditable}
        />
      </Suspense>

      <section className="panel">
        <h2>Practice log</h2>
        <HistoryView pieceId={piece.id} refreshKey={historyRefreshKey} />
      </section>
    </>
  )
}

/** A practice screen on a phone: the bigger-screen page instead (docs/learning-path.md, "Devices"). */
function PhoneShell({ pieceId, label }: { pieceId: string; label?: string }) {
  return (
    <AppShell active={undefined}>
      <BiggerScreen pieceId={pieceId} label={label} />
    </AppShell>
  )
}

function App() {
  const { path, search } = useRoute()
  const midi = useMidiInput()
  const isPhone = useIsPhone()

  // Sweeps up any attempt a previous session couldn't deliver — a closed
  // tab mid-push, the server briefly unreachable. See attemptsRepo.ts's
  // outbox doc comment.
  useEffect(() => {
    void flushOutbox()
  }, [])

  let params: Record<string, string> | undefined
  if ((params = matchPath('/piece/:id/free', path))) {
    const pieceId = params.id
    if (isPhone) return <PhoneShell pieceId={pieceId} label="Free practice" />
    return (
      <PracticeShell
        back={{ href: overviewHref(pieceId), label: 'Path' }}
        where={<strong>Free practice</strong>}
        right={<span className="shell-where">Plays anything · doesn't move the path</span>}
      >
        <div className="app app-free">
          <Suspense fallback={<div className="panel">Loading…</div>}>
            <FreePractice key={pieceId} pieceId={pieceId} midi={midi} />
          </Suspense>
        </div>
      </PracticeShell>
    )
  }
  if ((params = matchPath('/piece/:id/play', path))) {
    if (isPhone) return <PhoneShell pieceId={params.id} label={search.get('review') ? 'one run' : undefined} />
    // PathStep draws its own slim practice bar: what it says depends on the step.
    return (
      <Suspense fallback={<AppShell active={undefined}><p className="p-muted">Loading…</p></AppShell>}>
        <PathStep key={params.id} pieceId={params.id} midi={midi} search={search} />
      </Suspense>
    )
  }
  if ((params = matchPath('/piece/:id', path))) {
    if (isPhone) return <PhoneShell pieceId={params.id} label="overview" />
    return (
      <AppShell active="/library">
        <Suspense fallback={<p className="p-muted">Loading…</p>}>
          <PieceOverview key={params.id} pieceId={params.id} />
        </Suspense>
      </AppShell>
    )
  }

  switch (path) {
    case '/library':
      return (
        <AppShell active="/library">
          <LibraryView />
        </AppShell>
      )
    case '/sessions':
      return (
        <AppShell active="/sessions">
          <SessionsView />
        </AppShell>
      )
    case '/stats':
      return (
        <AppShell active="/stats">
          <StatsView />
        </AppShell>
      )
    case '/lesson':
      return (
        <AppShell active="/sessions">
          <LogLesson />
        </AppShell>
      )
    case '/done':
      return (
        <AppShell active="/">
          <SessionEnd />
        </AppShell>
      )
    default:
      return (
        <AppShell active="/">
          <TodayPlan />
        </AppShell>
      )
  }
}

export default App

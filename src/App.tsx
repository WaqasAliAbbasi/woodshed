import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { HistoryView } from './components/History/HistoryView'
import { InputSourceSelector } from './components/InputSourceSelector/InputSourceSelector'
import { useMidiInput } from './components/InputSourceSelector/useMidiInput'
import { McpInfoLink } from './components/McpInfo/McpInfo'
import { PieceLibrary } from './components/PieceLibrary/PieceLibrary'
import { SessionsView } from './components/Sessions/SessionsView'
import { StatsView } from './components/Stats/StatsView'
import { TargetTempoChip } from './components/TempoControl/TargetTempoChip'
import { flushOutbox } from './lib/db/attemptsRepo'
import { updatePiece, updateTargetTempo } from './lib/db/piecesRepo'
import { getTempoPresets } from './lib/musicxml/buildExpectedTimeline'
import type { Piece } from './lib/db/db'

/** The three top-level things there are to look at before opening a piece — see the nav rendered in the no-piece-selected branch of `App`, below. */
type TopLevelView = 'library' | 'sessions' | 'stats'

// Pulls in OpenSheetMusicDisplay, by far the heaviest dependency in the
// app, so it's kept out of the initial bundle and only fetched once a
// piece is actually opened.
const PracticeWorkspace = lazy(() =>
  import('./components/PracticeSession/PracticeWorkspace').then((m) => ({ default: m.PracticeWorkspace })),
)

function WoodshedMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 23 L24 7 L44 23" />
      <rect x="30" y="9" width="5" height="9" />
      <path d="M8 23 V41 H40 V23" />
      <rect x="20.5" y="29" width="7" height="12" />
    </svg>
  )
}

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

// A place for site-level links that aren't part of the practice flow
// itself — MCP docs today, room for e.g. privacy/about later — kept out of
// the header so it doesn't compete with the actual task at hand there.
function AppFooter() {
  return (
    <footer className="app-footer">
      <McpInfoLink />
    </footer>
  )
}

function LogoutButton() {
  return (
    <button
      type="button"
      className="link-back app-logout"
      onClick={() => {
        void fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => {
          window.location.href = '/login'
        })
      }}
    >
      Log out
    </button>
  )
}

function App() {
  const [piece, setPiece] = useState<Piece | undefined>(undefined)
  // Only meaningful while no piece is open — see the `!piece` branch below.
  // Not reset on opening/closing a piece: landing back on whichever
  // top-level view the student was on before opening a piece (not always
  // the library) is the less surprising behavior of the two.
  const [topLevelView, setTopLevelView] = useState<TopLevelView>('library')
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  // The score's own marked tempo, reported up once PracticeWorkspace has a
  // parsed score. Stands in as the target until the student sets one, and
  // anchors the presets to "full speed" rather than to whatever's dialed in.
  // Tagged with the piece it was read from, and ignored for any other:
  // App outlives a piece switch, so an untagged value would hand the next
  // piece the previous one's tempo for the render before its score loads —
  // and PracticeSession would start an attempt at it.
  const [scoreTempo, setScoreTempo] = useState<{ pieceId: string; bpm: number } | undefined>(undefined)
  // Tagged with its piece for the same reason as `scoreTempo`: leaving a
  // piece mid-attempt leaves this false, and the next piece starts idle —
  // an untagged flag would open its tempo chip disabled for no reason.
  const [editState, setEditState] = useState<{ pieceId: string; editable: boolean } | undefined>(undefined)
  const midi = useMidiInput()

  const editable = piece && editState?.pieceId === piece.id ? editState.editable : true
  const scoreTempoBpm = piece && scoreTempo?.pieceId === piece.id ? scoreTempo.bpm : undefined
  const targetTempoBpm = piece?.targetTempoBpm ?? scoreTempoBpm
  const tempoPresets = useMemo(() => (scoreTempoBpm === undefined ? undefined : getTempoPresets(scoreTempoBpm)), [scoreTempoBpm])

  const pieceId = piece?.id
  const handleScoreTempoResolved = useCallback(
    (bpm: number) => {
      if (pieceId) setScoreTempo({ pieceId, bpm })
    },
    [pieceId],
  )

  const handleEditableChange = useCallback(
    (nextEditable: boolean) => {
      if (pieceId) setEditState({ pieceId, editable: nextEditable })
    },
    [pieceId],
  )

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

  // Sweeps up any attempt a previous session couldn't deliver — a closed
  // tab mid-push, the server briefly unreachable. See attemptsRepo.ts's
  // outbox doc comment.
  useEffect(() => {
    void flushOutbox()
  }, [])

  if (!piece) {
    return (
      <main className="app">
        <header className="brand">
          <WoodshedMark />
          <h1>Woodshed</h1>
          <LogoutButton />
        </header>
        <nav className="top-nav" aria-label="Sections">
          {(
            [
              ['library', 'Library'],
              ['sessions', 'Sessions'],
              ['stats', 'Stats'],
            ] as const
          ).map(([view, label]) => (
            <button
              key={view}
              type="button"
              className={`top-nav-btn${topLevelView === view ? ' top-nav-btn-active' : ''}`}
              onClick={() => setTopLevelView(view)}
            >
              {label}
            </button>
          ))}
        </nav>
        {topLevelView === 'library' && <PieceLibrary onSelect={setPiece} />}
        {topLevelView === 'sessions' && <SessionsView />}
        {topLevelView === 'stats' && <StatsView />}
        <AppFooter />
      </main>
    )
  }

  return (
    <main className="app">
      <div className="app-header">
        <button type="button" className="link-back" onClick={() => setPiece(undefined)}>
          ‹ Library
        </button>
        <div className="app-title-block">
          <RenamableTitle piece={piece} onRenamed={setPiece} />
          <RenamableComposer piece={piece} onRenamed={setPiece} />
        </div>
        {targetTempoBpm !== undefined && (
          <TargetTempoChip
            tempoBpm={targetTempoBpm}
            presets={tempoPresets}
            disabled={!editable}
            onChange={handleTargetTempoChange}
          />
        )}
        <InputSourceSelector midi={midi} />
      </div>

      <Suspense fallback={<div className="panel">Loading practice tools…</div>}>
        <PracticeWorkspace
          piece={piece}
          midi={midi}
          progressRefreshKey={historyRefreshKey}
          onAttemptRecorded={() => setHistoryRefreshKey((k) => k + 1)}
          targetTempoBpm={targetTempoBpm}
          onScoreTempoResolved={handleScoreTempoResolved}
          onEditableChange={handleEditableChange}
        />
      </Suspense>

      <section className="panel">
        <h2>Practice log</h2>
        <HistoryView pieceId={piece.id} refreshKey={historyRefreshKey} />
      </section>
      <AppFooter />
    </main>
  )
}

export default App

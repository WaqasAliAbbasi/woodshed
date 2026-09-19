import { lazy, Suspense, useEffect, useState } from 'react'
import './App.css'
import { HistoryView } from './components/History/HistoryView'
import { InputSourceSelector } from './components/InputSourceSelector/InputSourceSelector'
import { useMidiInput } from './components/InputSourceSelector/useMidiInput'
import { PieceLibrary } from './components/PieceLibrary/PieceLibrary'
import { PieceProgress } from './components/PieceProgress/PieceProgress'
import { Dashboard } from './components/Dashboard/Dashboard'
import { flushOutbox } from './lib/db/attemptsRepo'
import { renamePiece } from './lib/db/piecesRepo'
import type { Piece } from './lib/db/db'

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
      const updated = await renamePiece(piece.id, title)
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
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  // No client-side router — the app has exactly two top-level views (the
  // piece library/practice workspace, and the read-only /dashboard). See
  // CLAUDE.md: no responsive-breakpoint or routing infrastructure existed
  // before the iPad fix either; a full router would be a lot of machinery
  // for one extra path.
  const [showDashboard] = useState(() => window.location.pathname.startsWith('/dashboard'))
  const midi = useMidiInput()

  // Sweeps up any attempt a previous session couldn't deliver — a closed
  // tab mid-push, the server briefly unreachable. See attemptsRepo.ts's
  // outbox doc comment.
  useEffect(() => {
    void flushOutbox()
  }, [])

  if (showDashboard) {
    return <Dashboard />
  }

  if (!piece) {
    return (
      <main className="app">
        <header className="brand">
          <WoodshedMark />
          <h1>Woodshed</h1>
          <LogoutButton />
        </header>
        <PieceLibrary onSelect={setPiece} />
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
          {piece.composer && <p className="app-composer">{piece.composer}</p>}
        </div>
      </div>

      <InputSourceSelector midi={midi} />

      <Suspense fallback={<div className="panel">Loading practice tools…</div>}>
        <PracticeWorkspace
          piece={piece}
          midi={midi}
          progressRefreshKey={historyRefreshKey}
          onAttemptRecorded={() => setHistoryRefreshKey((k) => k + 1)}
        />
      </Suspense>

      <section className="panel">
        <h2>Section progress</h2>
        <PieceProgress pieceId={piece.id} refreshKey={historyRefreshKey} />
      </section>

      <section className="panel">
        <h2>Practice log</h2>
        <HistoryView pieceId={piece.id} refreshKey={historyRefreshKey} />
      </section>
    </main>
  )
}

export default App

import { lazy, Suspense, useEffect, useState } from 'react'
import './App.css'
import { HistoryView } from './components/History/HistoryView'
import { InputSourceSelector } from './components/InputSourceSelector/InputSourceSelector'
import { useMidiInput } from './components/InputSourceSelector/useMidiInput'
import { McpInfoLink } from './components/McpInfo/McpInfo'
import { PieceLibrary } from './components/PieceLibrary/PieceLibrary'
import { flushOutbox } from './lib/db/attemptsRepo'
import { updatePiece } from './lib/db/piecesRepo'
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
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const midi = useMidiInput()

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
        <PieceLibrary onSelect={setPiece} />
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
        <InputSourceSelector midi={midi} />
      </div>

      <Suspense fallback={<div className="panel">Loading practice tools…</div>}>
        <PracticeWorkspace
          piece={piece}
          midi={midi}
          progressRefreshKey={historyRefreshKey}
          onAttemptRecorded={() => setHistoryRefreshKey((k) => k + 1)}
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

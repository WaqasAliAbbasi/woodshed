import { useState } from 'react'
import './App.css'
import { HistoryView } from './components/History/HistoryView'
import { InputSourceSelector } from './components/InputSourceSelector/InputSourceSelector'
import { useMidiInput } from './components/InputSourceSelector/useMidiInput'
import { PieceLibrary } from './components/PieceLibrary/PieceLibrary'
import { PracticeWorkspace } from './components/PracticeSession/PracticeWorkspace'
import { renamePiece } from './lib/db/piecesRepo'
import type { Piece } from './lib/db/db'

function RenamableTitle({ piece, onRenamed }: { piece: Piece; onRenamed: (piece: Piece) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(piece.title)

  const commit = async () => {
    const title = draft.trim()
    if (title && title !== piece.title) {
      onRenamed(await renamePiece(piece.id, title))
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

function App() {
  const [piece, setPiece] = useState<Piece | undefined>(undefined)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  const midi = useMidiInput()

  if (!piece) {
    return (
      <main className="app">
        <h1>Woodshed</h1>
        <PieceLibrary onSelect={setPiece} />
      </main>
    )
  }

  return (
    <main className="app">
      <div className="app-header">
        <button type="button" onClick={() => setPiece(undefined)}>
          ← Library
        </button>
        <RenamableTitle piece={piece} onRenamed={setPiece} />
      </div>

      <InputSourceSelector midi={midi} />

      <PracticeWorkspace
        piece={piece}
        midi={midi}
        onAttemptRecorded={() => setHistoryRefreshKey((k) => k + 1)}
      />

      <section>
        <h2>History</h2>
        <HistoryView pieceId={piece.id} refreshKey={historyRefreshKey} />
      </section>
    </main>
  )
}

export default App

import { useState } from 'react'
import './App.css'
import { HistoryView } from './components/History/HistoryView'
import { MidiDeviceSelector } from './components/MidiDeviceSelector/MidiDeviceSelector'
import { useMidiInput } from './components/MidiDeviceSelector/useMidiInput'
import { PieceLibrary } from './components/PieceLibrary/PieceLibrary'
import { PracticeWorkspace } from './components/PracticeSession/PracticeWorkspace'
import type { Piece } from './lib/db/db'

function App() {
  const [piece, setPiece] = useState<Piece | undefined>(undefined)
  const [currentSectionId, setCurrentSectionId] = useState<string | undefined>(undefined)
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
        <button
          type="button"
          onClick={() => {
            setPiece(undefined)
            setCurrentSectionId(undefined)
          }}
        >
          ← Library
        </button>
        <h1>{piece.title}</h1>
      </div>

      <MidiDeviceSelector midi={midi} />

      <PracticeWorkspace
        piece={piece}
        midi={midi}
        onAttemptRecorded={(sectionId) => {
          setCurrentSectionId(sectionId)
          setHistoryRefreshKey((k) => k + 1)
        }}
      />

      <section>
        <h2>History</h2>
        <HistoryView sectionId={currentSectionId} refreshKey={historyRefreshKey} />
      </section>
    </main>
  )
}

export default App

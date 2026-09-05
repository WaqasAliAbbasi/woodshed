import { useEffect, useRef, useState } from 'react'
import { createPiece, listPieces } from '../../lib/db/piecesRepo'
import type { Piece } from '../../lib/db/db'
import { decompressMxl } from '../../lib/musicxml/loadMxl'

export function PieceLibrary({ onSelect }: { onSelect: (piece: Piece) => void }) {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = () => listPieces().then(setPieces)

  useEffect(() => {
    refresh()
  }, [])

  const handleFile = async (file: File) => {
    setError(undefined)
    try {
      const musicXml = file.name.toLowerCase().endsWith('.mxl')
        ? await decompressMxl(await file.arrayBuffer())
        : await file.text()
      const titleMatch = musicXml.match(/<work-title>([^<]*)<\/work-title>/)
      const piece = await createPiece({
        title: titleMatch?.[1]?.trim() || file.name.replace(/\.(musicxml|xml|mxl)$/i, ''),
        filename: file.name,
        musicXml,
        // Placeholder — the real measure count comes from OSMD once the piece is opened and rendered.
        measureCount: 0,
      })
      await refresh()
      onSelect(piece)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="piece-library">
      <h2>Your pieces</h2>
      {pieces.length === 0 && <p>No pieces yet — upload a MusicXML file to get started.</p>}
      <ul>
        {pieces.map((piece) => (
          <li key={piece.id}>
            <button type="button" onClick={() => onSelect(piece)}>
              {piece.title}
            </button>
          </li>
        ))}
      </ul>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xml,.musicxml,.mxl"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />
      {error && <div className="banner banner-error">{error}</div>}
    </div>
  )
}

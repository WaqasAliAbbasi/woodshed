import { useEffect, useRef, useState } from 'react'
import { createPiece, deletePiece, listPieces } from '../../lib/db/piecesRepo'
import type { Piece } from '../../lib/db/db'
import { decompressMxl } from '../../lib/musicxml/loadMxl'
import { parseMusicXmlMetadata } from '../../lib/musicxml/parseMetadata'
import { isIOS } from '../../lib/platform'

export function PieceLibrary({ onSelect }: { onSelect: (piece: Piece) => void }) {
  const [pieces, setPieces] = useState<Piece[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = () => listPieces().then(setPieces)

  useEffect(() => {
    refresh()
  }, [])

  const accept = isIOS()
    ? 'application/octet-stream,text/xml,application/xml,application/vnd.recordare.musicxml+xml,.xml,.musicxml,.mxl'
    : '.xml,.musicxml,.mxl,text/xml,application/xml,application/vnd.recordare.musicxml+xml'

  const handleFile = async (file: File) => {
    setError(undefined)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!['xml', 'musicxml', 'mxl'].includes(ext ?? '')) {
        setError('Unsupported file type — please choose a .xml, .musicxml, or .mxl file.')
        return
      }
      const musicXml = ext === 'mxl'
        ? await decompressMxl(await file.arrayBuffer())
        : await file.text()
      const metadata = parseMusicXmlMetadata(musicXml)
      const piece = await createPiece({
        title: metadata.title || file.name.replace(/\.(musicxml|xml|mxl)$/i, ''),
        composer: metadata.composer,
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

  const handleDelete = async (piece: Piece) => {
    if (!window.confirm(`Delete "${piece.title}"? This also removes its sections and practice history.`)) {
      return
    }
    setError(undefined)
    try {
      await deletePiece(piece.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="piece-library panel">
      <h2>Your pieces</h2>
      {pieces.length === 0 && <p>No pieces yet — upload a MusicXML file to get started.</p>}
      <ul>
        {pieces.map((piece) => (
          <li key={piece.id} className="piece-row">
            <button type="button" className="piece-select" onClick={() => onSelect(piece)}>
              <span className="piece-title">{piece.title}</span>
              {piece.composer && <span className="piece-composer">{piece.composer}</span>}
            </button>
            <button
              type="button"
              className="piece-delete"
              aria-label={`Delete ${piece.title}`}
              onClick={() => void handleDelete(piece)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <input
        ref={fileInputRef}
        className="piece-upload"
        type="file"
        accept={accept}
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

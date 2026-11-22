import { useEffect, useRef, useState } from 'react'
import { listAllAttempts } from '../../lib/db/attemptsRepo'
import { createPiece, deletePiece, listPieces, type PieceSummary } from '../../lib/db/piecesRepo'
import { parseScore } from '../../lib/path/scoreMeasures'
import { parseMusicXmlMetadata } from '../../lib/musicxml/parseMetadata'
import { isIOS } from '../../lib/platform'
import { buildPieceStatsMap, formatDuration, formatPracticeDate, sortPiecesByRecency, type PieceStats } from '../../lib/pieceStats'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'

/**
 * Every piece as a flat list — the Library's "All pieces" (by title) and
 * "Recent" (by last practiced) views — plus single-file upload. `onOpen`
 * opens a piece's path; `onChanged` lets the parent refresh after an upload
 * or delete.
 */
export function PieceLibrary({
  onOpen,
  order = 'recent',
  onChanged,
}: {
  onOpen: (pieceId: string) => void
  order?: 'recent' | 'title'
  onChanged?: () => void
}) {
  const [pieces, setPieces] = useState<PieceSummary[]>([])
  const [statsByPieceId, setStatsByPieceId] = useState<Map<string, PieceStats>>(new Map())
  const [error, setError] = useState<string | undefined>(undefined)
  const [pendingDelete, setPendingDelete] = useState<PieceSummary | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = () =>
    Promise.all([listPieces(), listAllAttempts()]).then(([loadedPieces, attempts]) => {
      setPieces(loadedPieces)
      setStatsByPieceId(buildPieceStatsMap(attempts))
    })

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
        ? await (await import('../../lib/musicxml/loadMxl')).decompressMxl(await file.arrayBuffer())
        : await file.text()
      const metadata = parseMusicXmlMetadata(musicXml)
      const piece = await createPiece({
        title: metadata.title || file.name.replace(/\.(musicxml|xml|mxl)$/i, ''),
        composer: metadata.composer,
        filename: file.name,
        musicXml,
        measureCount: parseScore(musicXml).measures.length,
      })
      await refresh()
      onChanged?.()
      onOpen(piece.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDelete = async (piece: PieceSummary) => {
    setPendingDelete(undefined)
    setError(undefined)
    try {
      await deletePiece(piece.id)
      await refresh()
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section className="p-card p-collection" aria-label="All pieces">
      <div className="p-collection-head" style={{ alignItems: 'center' }}>
        <p className="p-muted" style={{ fontSize: 18 }}>
          {pieces.length} piece{pieces.length === 1 ? '' : 's'}, {order === 'title' ? 'by title' : 'most recently practised first'}
        </p>
        <button type="button" className="p-btn p-btn-outline p-btn-outline-pine" onClick={() => fileInputRef.current?.click()}>
          Add a piece
        </button>
      </div>
      {pieces.length === 0 && <p>No pieces yet. Add a MusicXML file to get started.</p>}
      <ul className="p-piece-list">
        {(order === 'title' ? [...pieces].sort((a, b) => a.title.localeCompare(b.title)) : sortPiecesByRecency(pieces, statsByPieceId)).map((piece) => {
          const stats = statsByPieceId.get(piece.id)
          return (
            <li key={piece.id} className="p-piece-row">
              <button type="button" onClick={() => onOpen(piece.id)}>
                <strong>{piece.title}</strong>
                <span className="p-muted" style={{ fontSize: 16 }}>
                  {[
                    piece.composer,
                    stats
                      ? `${formatDuration(stats.totalDurationMs)} practised · last ${formatPracticeDate(stats.lastPracticedAt)}`
                      : 'Not practised yet',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
              <button type="button" className="p-link" style={{ fontSize: 15, color: 'var(--muted)' }} aria-label={`Delete ${piece.title}`} onClick={() => setPendingDelete(piece)}>
                Delete
              </button>
            </li>
          )
        })}
      </ul>
      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept={accept}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />
      {error && <p className="p-error">{error}</p>}

      {pendingDelete && (
        <ConfirmDialog
          message={`Delete "${pendingDelete.title}"? This also removes its sections and practice history.`}
          onConfirm={() => void handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(undefined)}
        />
      )}
    </section>
  )
}

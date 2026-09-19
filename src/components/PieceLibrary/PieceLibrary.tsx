import { useEffect, useRef, useState } from 'react'
import { listAllAttempts } from '../../lib/db/attemptsRepo'
import { downloadExport } from '../../lib/db/export'
import { uploadLocalHistoryToServer } from '../../lib/db/import'
import { createPiece, deletePiece, getPiece, listPieces, type PieceSummary } from '../../lib/db/piecesRepo'
import type { Piece } from '../../lib/db/db'
import { parseMusicXmlMetadata } from '../../lib/musicxml/parseMetadata'
import { isIOS } from '../../lib/platform'
import { buildPieceStatsMap, formatDuration, formatPracticeDate, sortPiecesByRecency, type PieceStats } from '../../lib/pieceStats'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'

export function PieceLibrary({ onSelect }: { onSelect: (piece: Piece) => void }) {
  const [pieces, setPieces] = useState<PieceSummary[]>([])
  const [statsByPieceId, setStatsByPieceId] = useState<Map<string, PieceStats>>(new Map())
  const [error, setError] = useState<string | undefined>(undefined)
  const [pendingDelete, setPendingDelete] = useState<PieceSummary | undefined>(undefined)
  const [openingPieceId, setOpeningPieceId] = useState<string | undefined>(undefined)
  const [migrating, setMigrating] = useState(false)
  const [migrationMessage, setMigrationMessage] = useState<string | undefined>(undefined)
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
        // Placeholder — the real measure count comes from OSMD once the piece is opened and rendered.
        measureCount: 0,
      })
      await refresh()
      onSelect(piece)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // The library list holds summaries (no musicXml — see PieceSummary), so
  // opening a piece means fetching the full record first. createPiece's
  // return value above already has musicXml and skips this.
  const handleSelect = async (piece: PieceSummary) => {
    setError(undefined)
    setOpeningPieceId(piece.id)
    try {
      const full = await getPiece(piece.id)
      if (!full) {
        setError('That piece no longer exists — refreshing the list.')
        await refresh()
        return
      }
      onSelect(full)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpeningPieceId(undefined)
    }
  }

  const handleDelete = async (piece: PieceSummary) => {
    setPendingDelete(undefined)
    setError(undefined)
    try {
      await deletePiece(piece.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleUploadLocalHistory = async () => {
    setError(undefined)
    setMigrationMessage(undefined)
    setMigrating(true)
    try {
      const result = await uploadLocalHistoryToServer()
      setMigrationMessage(
        `Imported ${result.pieces} piece${result.pieces === 1 ? '' : 's'}, ${result.sections} section${result.sections === 1 ? '' : 's'}, and ${result.attempts} attempt${result.attempts === 1 ? '' : 's'} from this browser.`,
      )
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setMigrating(false)
    }
  }

  return (
    <div className="piece-library panel">
      <h2>Your pieces</h2>
      {pieces.length === 0 && <p>No pieces yet — upload a MusicXML file to get started.</p>}
      <ul>
        {sortPiecesByRecency(pieces, statsByPieceId).map((piece) => {
          const stats = statsByPieceId.get(piece.id)
          return (
            <li key={piece.id} className="piece-row">
              <button
                type="button"
                className="piece-select"
                disabled={openingPieceId === piece.id}
                onClick={() => void handleSelect(piece)}
              >
                <span className="piece-title">{piece.title}</span>
                {piece.composer && <span className="piece-composer">{piece.composer}</span>}
                {stats && (
                  <span className="piece-meta">
                    {formatDuration(stats.totalDurationMs)} practiced · first {formatPracticeDate(stats.firstPracticedAt)} · last{' '}
                    {formatPracticeDate(stats.lastPracticedAt)}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="piece-delete"
                aria-label={`Delete ${piece.title}`}
                onClick={() => setPendingDelete(piece)}
              >
                Delete
              </button>
            </li>
          )
        })}
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

      {/* Backup/migration — see src/lib/db/export.ts and import.ts. "Import"
          reads whatever this browser had stored locally before it started
          talking to the server (relevant once, right after this server was
          first deployed); "Download" is a standing backup independent of
          the server's own nightly one. */}
      <div className="piece-library-backup">
        <button type="button" onClick={() => void downloadExport()}>
          Download backup
        </button>
        <button type="button" disabled={migrating} onClick={() => void handleUploadLocalHistory()}>
          {migrating ? 'Importing…' : 'Import this browser’s history'}
        </button>
      </div>
      {migrationMessage && <div className="banner banner-success">{migrationMessage}</div>}

      {pendingDelete && (
        <ConfirmDialog
          message={`Delete "${pendingDelete.title}"? This also removes its sections and practice history.`}
          onConfirm={() => void handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(undefined)}
        />
      )}
    </div>
  )
}

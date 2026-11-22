import { describeStep, type ChunkState, type PiecePath } from '../../lib/path/nextStep'
import { navigate } from '../../lib/router'
import { freePracticeHref } from './links'
import { usePiecePath } from './usePiecePath'
import './path.css'

/** The score as a strip of chunks (`Main` / `OverviewRepeats` artboards): one chip per chunk, one cell per bar, repeats shaded. */
export function ChunkStrip({ path }: { path: PiecePath }) {
  return (
    <section className="p-card p-strip" aria-label="Score split into chunks">
      <div className="p-strip-inner">
        {path.chunks.map((c) => (
          <StripChunk key={c.chunk.id} c={c} />
        ))}
      </div>
    </section>
  )
}

function StripChunk({ c }: { c: ChunkState }) {
  const bars = c.chunk.endMeasure - c.chunk.startMeasure + 1
  const repeat = c.repeatOf !== undefined
  const ready = c.progress.ready
  return (
    <div className={`p-strip-chunk${repeat ? ' p-strip-repeat' : ''}${ready && !repeat ? ' p-strip-ready' : ''}`} style={{ flex: `${bars} 1 0` }}>
      <span className={`p-strip-chip${repeat ? ' p-strip-chip-repeat' : ready ? ' p-strip-chip-ready' : ''}`}>
        <strong>Chunk {c.number}</strong>
        <span className="p-muted">
          {repeat ? `same as ${c.repeatOf}` : ready ? 'ready' : `m. ${c.chunk.startMeasure}–${c.chunk.endMeasure}`}
        </span>
      </span>
      <div className="p-strip-bars">
        {Array.from({ length: bars }, (_, i) => (
          <div key={i} className="p-strip-bar">
            <span>{c.chunk.startMeasure + i}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The hard-locked whole piece (`JoinLock` artboard): what's left, and the way round it that doesn't move the path. */
export function WholePieceLock({ path, pieceId }: { path: PiecePath; pieceId: string }) {
  const lock = path.wholeLock
  if (!lock) return null
  const left = lock.remainingChunks
  const why =
    left.length > 0
      ? `${left.length} to go: chunk${left.length === 1 ? '' : 's'} ${left.join(left.length === 2 ? ' and ' : ', ')}.`
      : `Join 1–${lock.waitingForJoin} first.`
  return (
    <section className="p-card p-lock" aria-label="Whole piece, locked" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p className="p-eyebrow">Whole piece</p>
      <p>Opens when every chunk is ready and joined. {why}</p>
      <button type="button" className="p-btn" disabled>
        🔒 Play whole piece
      </button>
      <p className="p-muted p-small">
        Want to try anyway?{' '}
        <button type="button" className="p-link" style={{ fontSize: 16 }} onClick={() => navigate(freePracticeHref(pieceId))}>
          Free practice
        </button>{' '}
        plays anything; it just won't move the path.
      </p>
    </section>
  )
}

function primaryLabel(path: PiecePath): string {
  const next = path.next
  if (next.kind === 'complete') return 'Play the whole piece'
  if (next.kind === 'chunk' && next.idx === 0 && next.rung === 'notes' && path.chunks[0].progress.rung2.tries === 0) return 'Start chunk 1'
  if (next.kind === 'join' && next.whole) return 'Play the whole piece'
  return `Continue: ${describeStep(next)}`
}

/** A piece's path at a glance — laptop/tablet only (see BiggerScreen). */
export function PieceOverview({ pieceId }: { pieceId: string }) {
  const { data, derived, error } = usePiecePath(pieceId)
  if (error) return <div className="path"><p className="p-error">{error}</p></div>
  if (!data || !derived) return <div className="path"><p className="p-muted">Loading the piece…</p></div>

  const { piece } = data
  const { path, target } = derived
  const toLearn = path.chunks.filter((c) => c.repeatOf === undefined).length
  const repeats = path.chunks.length - toLearn
  const started = path.chunks.some((c) => c.progress.rung2.tries > 0 || c.progress.ready)
  const eyebrow = piece.finishedAt !== undefined ? 'Finished with your teacher' : path.complete ? 'Ready' : started ? 'In progress' : 'New piece'

  return (
    <div className="path">
      <nav className="p-topbar" aria-label="Piece">
        <button type="button" className="p-link" onClick={() => navigate('/library')}>
          ‹ Library
        </button>
        <button type="button" className="p-link" onClick={() => navigate(freePracticeHref(piece.id))}>
          Free practice
        </button>
      </nav>

      <div className="p-header">
        <div>
          <p className="p-eyebrow">{eyebrow}</p>
          <h1 className="p-h1">{piece.title}</h1>
          <p className="p-muted" style={{ marginTop: 8 }}>
            {[piece.composer, `${data.measureCount} bars, ${data.newMeasureCount} new`, `target ${target} bpm`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <p style={{ fontSize: 22 }}>
          <strong>
            {toLearn} chunk{toLearn === 1 ? '' : 's'} to learn
          </strong>
          {repeats > 0 && <span className="p-muted"> · {repeats} more repeat them</span>}
          {path.readyChunkCount > 0 && <span className="p-muted"> · {path.readyChunkCount} ready</span>}
        </p>
      </div>

      <ChunkStrip path={path} />
      {repeats > 0 && <p className="p-muted p-small">Shaded chunks repeat earlier ones exactly. They're ready as soon as the chunk they copy is ready.</p>}

      <div className="p-split" style={{ alignItems: 'flex-end' }}>
        <section className="p-main">
          <h2 className="p-h2">How you'll learn it</h2>
          <ol className="p-howto">
            <li className="p-card">
              <p style={{ fontWeight: 600 }}>1 · One chunk at a time</p>
              <p className="p-muted p-small">Notes first, then with the metronome, until it's ready.</p>
            </li>
            <li className="p-card">
              <p style={{ fontWeight: 600 }}>2 · Join neighbours</p>
              <p className="p-muted p-small">Each ready chunk joins the ones before it.</p>
            </li>
            <li className="p-card">
              <p style={{ fontWeight: 600 }}>3 · The whole piece</p>
              <p className="p-muted p-small">Opens once every chunk is ready.</p>
            </li>
          </ol>
        </section>
        <div className="p-side">
          <button type="button" className="p-btn p-btn-primary" onClick={() => navigate(`/piece/${encodeURIComponent(piece.id)}/play`)}>
            {primaryLabel(path)} →
          </button>
          <p className="p-muted p-small" style={{ textAlign: 'center' }}>
            Chunks follow the phrases in the score.
          </p>
        </div>
      </div>

      <WholePieceLock path={path} pieceId={piece.id} />
    </div>
  )
}

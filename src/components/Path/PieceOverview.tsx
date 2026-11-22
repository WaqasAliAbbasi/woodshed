import { describeStep, RUNG_NAME, type ChunkState, type PiecePath } from '../../lib/path/nextStep'
import { navigate } from '../../lib/router'
import { AppLink } from '../AppShell/AppShell'
import { freePracticeHref } from './links'
import { usePiecePath } from './usePiecePath'
import './path.css'

export function ArrowIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

/** Where a chunk stands, in a word or two: "ready", "metronome", "not started". */
function chunkStatus(c: ChunkState): string {
  if (c.repeatOf !== undefined) return `same as ${c.repeatOf}`
  const p = c.progress
  if (p.ready) return 'ready'
  if (p.rung2.tries === 0 && p.rung1.tries === 0) return 'not started'
  return RUNG_NAME[p.current === 'ready' ? 'tempo' : p.current].toLowerCase()
}

/**
 * The score as a strip of chunks (`Main`, `OverviewRepeats` and `JoinLock`
 * artboards): a chip per chunk, a pair of staves per bar, chunk edges in
 * pine, repeats hatched, ready bars washed green and started ones grey.
 * `status` puts each chunk's progress in its chip instead of its bars;
 * `joinedThrough` brackets the bars a passed join covers.
 */
export function ChunkStrip({ path, status = false, joinedThrough }: { path: PiecePath; status?: boolean; joinedThrough?: number }) {
  const first = path.chunks[0]?.chunk.startMeasure ?? 0
  const last = path.chunks.at(-1)?.chunk.endMeasure ?? first
  const total = last - first + 1
  const joined = joinedThrough !== undefined ? joinedThrough - first + 1 : 0
  return (
    <section className="p-card p-strip" aria-label="Score split into chunks">
      <div className="p-strip-inner">
        <div className="p-strip-row">
          {path.chunks.map((c, i) => (
            <StripChunk key={c.chunk.id} c={c} status={status} last={i === path.chunks.length - 1} />
          ))}
        </div>
        {joined > 0 && (
          <div className="p-strip-row" aria-hidden="true">
            <div className="p-strip-bracket" style={{ flex: `${joined} 1 0` }} />
            {total > joined && <div style={{ flex: `${total - joined} 1 0` }} />}
          </div>
        )}
      </div>
    </section>
  )
}

function StripChunk({ c, status, last }: { c: ChunkState; status: boolean; last: boolean }) {
  const bars = c.chunk.endMeasure - c.chunk.startMeasure + 1
  const repeat = c.repeatOf !== undefined
  const ready = c.progress.ready
  const started = !ready && (c.progress.rung2.tries > 0 || c.progress.rung1.tries > 0)
  const word = chunkStatus(c)
  const chipClass = repeat ? ' p-strip-chip-repeat' : status && ready ? ' p-strip-chip-ready' : status && word === 'not started' ? ' p-strip-chip-new' : ''
  const wash = ready ? ' p-strip-wash-ready' : started ? ' p-strip-wash-touched' : ''
  return (
    <div className={`p-strip-chunk${repeat ? ' p-strip-repeat' : ''}`} style={{ flex: `${bars} 1 0` }}>
      <span className={`p-strip-chip${chipClass}`}>
        <strong>{status ? c.number : `Chunk ${c.number}`}</strong>
        <span>{status || repeat ? word : `m. ${c.chunk.startMeasure}–${c.chunk.endMeasure}`}</span>
      </span>
      <div className="p-strip-bars">
        {Array.from({ length: bars }, (_, i) => (
          <div key={i} className={`p-strip-bar${i === 0 ? ' p-strip-bar-first' : ''}${wash}`}>
            <span>{c.chunk.startMeasure + i}</span>
            <i />
            <i />
          </div>
        ))}
        {last && <div className="p-strip-end" />}
      </div>
    </div>
  )
}

function LockIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
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
    <section className="p-card p-lock" aria-label="Whole piece, locked">
      <div className="p-lock-head">
        <LockIcon />
        <div>
          <p className="p-lock-title">Whole piece</p>
          <p className="p-muted p-small">Opens when every chunk is ready and joined. {why}</p>
        </div>
      </div>
      <button type="button" className="p-btn" disabled>
        Play whole piece
      </button>
      <p className="p-muted p-small">
        Want to try anyway? <AppLink href={freePracticeHref(pieceId)}>Free practice</AppLink> plays anything; it just won't move the path.
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

/** A piece's path at a glance (`Main` / `OverviewRepeats` artboards) — laptop/tablet only (see BiggerScreen). */
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
  const sizeLine =
    repeats > 0 ? `${data.measureCount} bars, but only ${data.newMeasureCount} are new` : `${data.measureCount} bars, ${data.newMeasureCount} new`

  return (
    <div className="path">
      <div className="p-header">
        <div>
          <p className="p-eyebrow">{eyebrow}</p>
          <h1 className="p-h1">{piece.title}</h1>
          <p className="p-muted" style={{ marginTop: 8 }}>
            {[piece.composer, sizeLine, `target ${target} bpm`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="p-header-side">
          <p style={{ fontSize: 22 }}>
            <strong>
              {repeats > 0 ? `${toLearn} chunk${toLearn === 1 ? '' : 's'} to learn` : `${path.chunks.length} chunk${path.chunks.length === 1 ? '' : 's'}`}
            </strong>
            <span className="p-muted">
              {repeats > 0 ? ` · ${repeats} more repeat them` : ` · ${data.newMeasureCount} of ${data.measureCount} bars are new`}
            </span>
          </p>
          {path.readyChunkCount > 0 && (
            <p className="p-muted p-small">
              {path.readyChunkCount} of {path.chunks.length} ready
            </p>
          )}
          <AppLink href={freePracticeHref(piece.id)} className="p-small">
            Free practice
          </AppLink>
        </div>
      </div>

      <div className="p-strip-wrap">
        <ChunkStrip path={path} />
        {repeats > 0 && <p className="p-muted p-small">Shaded chunks repeat earlier ones exactly. They're ready as soon as the chunk they copy is ready.</p>}
      </div>

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
            {primaryLabel(path)}
            <ArrowIcon />
          </button>
          <p className="p-muted p-small" style={{ textAlign: 'center' }}>
            Chunks follow the phrases in the score.
          </p>
        </div>
      </div>

      {started && <WholePieceLock path={path} pieceId={piece.id} />}
    </div>
  )
}

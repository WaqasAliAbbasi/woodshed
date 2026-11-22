import { useRef, useState } from 'react'
import {
  addPieceToCollection,
  createCollection,
  ensureChunks,
  updateCollection,
  type Collection,
  type CollectionKind,
  type PathOverview,
} from '../../lib/db/pathRepo'
import { createPiece, type PieceSummary } from '../../lib/db/piecesRepo'
import { parseMusicXmlMetadata } from '../../lib/musicxml/parseMetadata'
import type { DerivedState } from '../../lib/path/deriveState'
import { readBookFolder, targetFromMetadata } from '../../lib/path/folderImport'
import { parseScore } from '../../lib/path/scoreMeasures'
import { navigate } from '../../lib/router'
import { PieceLibrary } from '../PieceLibrary/PieceLibrary'
import { AppLink } from '../AppShell/AppShell'
import { overviewHref } from './links'
import { ChunkCells } from './TodayPlan'
import { usePathData } from './usePathData'
import './path.css'

type Grouping = 'collection' | 'all' | 'recent'

/** done = the teacher said Finished; current = the latest lesson left it Keep going or New. */
function pieceState(pieceId: string, derived: DerivedState): 'done' | 'current' | 'todo' {
  const input = derived.plan.pieces.find((p) => p.pieceId === pieceId)
  if (!input) return 'todo'
  if (input.finished) return 'done'
  if (input.lesson && input.lesson.outcome !== 'finished') return 'current'
  return 'todo'
}

function sizeLine(piece: PieceSummary, overview: PathOverview): string {
  const chunks = overview.chunks.filter((c) => c.pieceId === piece.id)
  const repeats = chunks.filter((c) => c.repeatOfChunkId !== undefined).length
  const bars = piece.measureCount > 0 ? `${piece.measureCount} bars${piece.newMeasureCount !== undefined ? `, ${piece.newMeasureCount} new` : ''}` : undefined
  const chunkText = chunks.length > 0 ? `${chunks.length} chunks${repeats > 0 ? `, ${repeats} ${repeats === 1 ? 'is a repeat' : 'are repeats'}` : ''}` : undefined
  return [bars, chunkText].filter(Boolean).join(' · ')
}

/**
 * The Library (`Library` artboard): grouped by collection — an exam set,
 * a book in page order with its progress marks and what's up next — or as
 * the plain list of every piece, by title or by recency. Phone-friendly.
 */
export function LibraryView() {
  const { overview, derived, error, reload } = usePathData()
  const [grouping, setGrouping] = useState<Grouping>('collection')

  return (
    <div className="path">
      <div className="p-header">
        <h1 className="p-h1">Library</h1>
        <div className="p-segmented" role="group" aria-label="Group pieces">
          {(
            [
              ['collection', 'By collection'],
              ['all', 'All pieces'],
              ['recent', 'Recent'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={grouping === value} onClick={() => setGrouping(value)} style={{ padding: '0 14px' }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="p-error">{error}</p>}
      {grouping !== 'collection' ? (
        <PieceLibrary order={grouping === 'all' ? 'title' : 'recent'} onOpen={(id) => navigate(overviewHref(id))} onChanged={() => void reload()} />
      ) : !overview || !derived ? (
        <p className="p-muted">Loading…</p>
      ) : (
        <Collections overview={overview} derived={derived} reload={reload} />
      )}
    </div>
  )
}

function Collections({ overview, derived, reload }: { overview: PathOverview; derived: DerivedState; reload: () => Promise<void> }) {
  const inCollection = new Set(overview.collections.flatMap((c) => c.pieces.map((p) => p.pieceId)))
  const loose = overview.pieces.filter((p) => !inCollection.has(p.id)).sort((a, b) => a.title.localeCompare(b.title))
  const ordered = [...overview.collections].sort((a, b) => Number(b.kind === 'exam') - Number(a.kind === 'exam'))

  return (
    <>
      {ordered.map((c) =>
        c.kind === 'book' ? (
          <BookCard key={c.id} collection={c} overview={overview} derived={derived} reload={reload} />
        ) : (
          <SetCard key={c.id} collection={c} overview={overview} derived={derived} reload={reload} />
        ),
      )}
      <section className="p-loose" aria-labelledby="loose-title">
        <div className="p-collection-head" style={{ alignItems: 'center' }}>
          <div>
            <h2 id="loose-title" className="p-h2" style={{ fontSize: 24 }}>
              Not in a collection
            </h2>
            <p className="p-muted p-small" style={{ marginTop: 2 }}>
              {loose.length === 0
                ? 'Every piece is in a collection.'
                : loose.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ' · '}
                      <AppLink href={overviewHref(p.id)}>{p.title}</AppLink>
                    </span>
                  ))}
            </p>
          </div>
          <NewCollection reload={reload} />
        </div>
        <ImportBook overview={overview} reload={reload} label="Import a book folder" />
      </section>
    </>
  )
}

function AddPiece({ collection, overview, reload }: { collection: Collection; overview: PathOverview; reload: () => Promise<void> }) {
  const members = new Set(collection.pieces.map((p) => p.pieceId))
  const addable = overview.pieces.filter((p) => !members.has(p.id)).sort((a, b) => a.title.localeCompare(b.title))
  if (addable.length === 0) return null
  return (
    <label className="p-actions p-muted" style={{ fontSize: 16 }}>
      Add a piece
      <select
        className="p-select"
        value=""
        onChange={(e) => {
          if (e.target.value) void addPieceToCollection(collection.id, e.target.value).then(reload)
        }}
      >
        <option value="">Choose…</option>
        {addable.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
    </label>
  )
}

/** An exam set (or any other non-book collection): each piece with its chunk cells and where it stands. */
function SetCard({ collection, overview, derived, reload }: { collection: Collection; overview: PathOverview; derived: DerivedState; reload: () => Promise<void> }) {
  const byId = new Map(overview.pieces.map((p) => [p.id, p]))
  const pieces = collection.pieces.map((m) => byId.get(m.pieceId)).filter((p): p is PieceSummary => p !== undefined)
  const date = collection.examDate !== undefined ? new Date(collection.examDate).toISOString().slice(0, 10) : ''
  return (
    <section className="p-card p-collection" aria-label={collection.name}>
      <div className="p-collection-head">
        <div>
          <p className="p-eyebrow" style={{ marginBottom: 0 }}>
            {collection.kind === 'exam' ? 'Exam' : 'Collection'}
          </p>
          <h2 className="p-collection-title">{collection.name}</h2>
          <p className="p-muted" style={{ marginTop: 4, fontSize: 18 }}>
            {pieces.length} piece{pieces.length === 1 ? '' : 's'}
            {collection.kind === 'exam' && (collection.examDate === undefined ? ' · no exam date yet, so plans aim for your lessons' : '')}
          </p>
        </div>
        {collection.kind === 'exam' && <ExamDate collection={collection} date={date} reload={reload} />}
      </div>
      <ul className="p-set">
        {pieces.map((p) => {
          const path = derived.paths.get(p.id)
          const state = pieceState(p.id, derived)
          const status =
            state === 'done'
              ? 'Finished with your teacher'
              : path
                ? path.complete
                  ? `Whole piece ready at ${derived.targets.get(p.id)}`
                  : `${path.readyChunkCount} of ${path.chunks.length} chunks ready`
                : 'Not started on the path'
          return (
            <li key={p.id}>
              <button type="button" className="p-set-piece" onClick={() => navigate(overviewHref(p.id))}>
                <strong>{p.title}</strong>
                {path && <ChunkCells path={path} />}
                <span className="p-muted" style={{ fontSize: 16 }}>
                  {status}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <AddPiece collection={collection} overview={overview} reload={reload} />
    </section>
  )
}

/** "Set exam date" until there is one; then the date, editable. */
function ExamDate({ collection, date, reload }: { collection: Collection; date: string; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  if (!date && !editing) {
    return (
      <button type="button" className="p-btn p-btn-outline p-btn-outline-pine" onClick={() => setEditing(true)}>
        Set exam date
      </button>
    )
  }
  return (
    <label className="p-actions p-muted" style={{ fontSize: 16 }}>
      Exam date
      <input
        className="p-input"
        type="date"
        value={date}
        autoFocus={editing}
        onChange={(e) => void updateCollection(collection.id, { examDate: e.target.value ? new Date(e.target.value).getTime() : null }).then(reload)}
      />
    </label>
  )
}

/** A book in page order: one mark per piece (done / current / not yet) and the next pieces up. */
function BookCard({ collection, overview, derived, reload }: { collection: Collection; overview: PathOverview; derived: DerivedState; reload: () => Promise<void> }) {
  const byId = new Map(overview.pieces.map((p) => [p.id, p]))
  const members = collection.pieces.filter((m) => byId.has(m.pieceId))
  const states = members.map((m) => ({ m, piece: byId.get(m.pieceId)!, state: pieceState(m.pieceId, derived) }))
  const current = states.filter((s) => s.state === 'current')
  const lastStartedIdx = Math.max(-1, ...states.map((s, i) => (s.state !== 'todo' ? i : -1)))
  const upNext = [...current, ...states.slice(lastStartedIdx + 1).filter((s) => s.state === 'todo')].slice(0, 3)
  const currentPage = current[0]?.m.page
  const done = states.filter((s) => s.state === 'done').length

  return (
    <section className="p-card p-collection" aria-label={collection.name}>
      <div className="p-collection-head">
        <div>
          <p className="p-eyebrow" style={{ marginBottom: 0 }}>
            Book · in page order
          </p>
          <h2 className="p-collection-title">{collection.name}</h2>
          <p className="p-muted" style={{ marginTop: 4, fontSize: 18 }}>
            {members.length} pieces{currentPage !== undefined ? ` · you're on page ${currentPage}` : ''} · {done} done with your teacher
          </p>
        </div>
        <ImportBook overview={overview} reload={reload} label="Import the rest of the book" />
      </div>
      <div className="p-book-marks" aria-label="Book progress, one mark per piece">
        {states.map((s) => (
          <span
            key={s.m.pieceId}
            title={`${s.m.page !== undefined ? `p. ${s.m.page} · ` : ''}${s.piece.title}`}
            className={s.state === 'done' ? 'p-mark-done' : s.state === 'current' ? 'p-mark-current' : undefined}
          />
        ))}
      </div>
      <div className="p-legend">
        <span>
          <i className="p-mark-done" />
          Done with your teacher
        </span>
        <span>
          <i className="p-mark-current" />
          Current
        </span>
        <span>
          <i />
          Not yet
        </span>
      </div>
      {upNext.length > 0 && (
        <div className="p-upnext">
          {upNext.map((s, i) => (
            <button
              key={s.m.pieceId}
              type="button"
              className={s.state === 'current' ? 'p-upnext-current' : undefined}
              onClick={() => navigate(overviewHref(s.m.pieceId))}
            >
              <span className={`p-eyebrow${s.state === 'current' ? ' p-eyebrow-accent' : ''}`} style={{ marginBottom: 0, fontSize: 14 }}>
                {s.state === 'current' ? 'Current' : i === current.length ? 'Next' : 'Then'}
                {s.m.page !== undefined ? ` · p. ${s.m.page}` : ''}
              </span>
              <span className="p-upnext-title">{s.piece.title}</span>
              <span className="p-muted" style={{ fontSize: 16 }}>
                {sizeLine(s.piece, overview)}
              </span>
            </button>
          ))}
        </div>
      )}
      <AddPiece collection={collection} overview={overview} reload={reload} />
    </section>
  )
}

function NewCollection({ reload }: { reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CollectionKind>('exam')
  if (!open) {
    return (
      <button type="button" className="p-btn p-btn-outline p-btn-outline-pine" onClick={() => setOpen(true)}>
        New collection
      </button>
    )
  }
  return (
    <form
      className="p-row"
      style={{ alignItems: 'flex-end' }}
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        void createCollection({ name: name.trim(), kind }).then(() => {
          setOpen(false)
          setName('')
          return reload()
        })
      }}
    >
      <label className="p-field">
        Name
        <input type="text" value={name} placeholder="e.g. ABRSM Grade 1" onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="p-field">
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as CollectionKind)}>
          <option value="exam">Exam set</option>
          <option value="book">Book</option>
          <option value="other">Other</option>
        </select>
      </label>
      <button type="submit" className="p-btn" style={{ flex: '0 0 auto' }}>
        Create
      </button>
    </form>
  )
}

/**
 * Imports a whole book folder: one piece per `NNN - Title` subfolder, in a
 * book collection of the folder's name (an existing one is added to —
 * pages already in it are skipped, so "import the rest of the book" works).
 * Each piece is chunked as it lands, so the book's "up next" can show sizes.
 */
function ImportBook({ overview, reload, label }: { overview: PathOverview; reload: () => Promise<void>; label: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState<string[]>([])

  const run = async (files: File[]) => {
    const byPath = new Map(files.map((f) => [f.webkitRelativePath, f]))
    const { bookName, entries } = readBookFolder([...byPath.keys()])
    if (!bookName || entries.length === 0) {
      setProgress('No "NNN - Title" folders with a score in them were found.')
      return
    }
    let book = overview.collections.find((c) => c.kind === 'book' && c.name === bookName)
    book ??= await createCollection({ name: bookName, kind: 'book' })
    const havePages = new Set(book.pieces.map((p) => p.page))
    const todo = entries.filter((e) => !havePages.has(e.page))
    const problems: string[] = []
    for (const [i, entry] of todo.entries()) {
      setProgress(`Importing ${i + 1} of ${todo.length}: ${entry.title}`)
      try {
        const file = byPath.get(entry.scorePath)!
        const musicXml = entry.scorePath.toLowerCase().endsWith('.mxl')
          ? await (await import('../../lib/musicxml/loadMxl')).decompressMxl(await file.arrayBuffer())
          : await file.text()
        const metadataFile = entry.metadataPath ? byPath.get(entry.metadataPath) : undefined
        const piece = await createPiece({
          title: entry.title,
          composer: parseMusicXmlMetadata(musicXml).composer,
          filename: file.name,
          musicXml,
          measureCount: parseScore(musicXml).measures.length,
          targetTempoBpm: metadataFile ? targetFromMetadata(await metadataFile.text()) : undefined,
        })
        await ensureChunks(piece)
        await addPieceToCollection(book.id, piece.id, entry.page)
      } catch (err) {
        problems.push(`p. ${entry.page} ${entry.title}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setFailed(problems)
    setProgress(`Imported ${todo.length - problems.length} piece${todo.length - problems.length === 1 ? '' : 's'} into ${bookName}${entries.length > todo.length ? ` (${entries.length - todo.length} already there)` : ''}.`)
    await reload()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" className="p-btn p-btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => inputRef.current?.click()}>
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        // Non-standard but supported by every browser this app targets.
        {...{ webkitdirectory: '', directory: '' }}
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length > 0) void run(files)
        }}
      />
      {progress && <p className="p-muted p-small">{progress}</p>}
      {failed.length > 0 && (
        <ul className="p-error p-small" style={{ margin: 0 }}>
          {failed.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

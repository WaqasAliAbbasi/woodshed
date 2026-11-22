import type { Section } from '../db/db.ts'
import { isReadyAttempt, rungProgress, STUCK_AFTER_TRIES, type ChunkProgress, type ChunkRung, type ChunkRungAttempts } from './rungProgress.ts'
import type { Chunk, PathAttempt } from './types.ts'

/** Something on the path that can be played: one chunk, or a join of chunks 1..k (k = chunk count is the whole piece). */
export type PathItem = { kind: 'chunk'; idx: number } | { kind: 'join'; k: number }

export interface ChunkState {
  chunk: Chunk
  /** 1-based, as shown. */
  number: number
  /** A repeat's progress is its source's — it has nothing new of its own to learn. */
  progress: ChunkProgress
  /** 1-based number of the chunk this one copies. */
  repeatOf?: number
}

export interface JoinState {
  /** Joins chunks 1..k. */
  k: number
  /** The chunk whose readiness opens this join; path sections for it hang off this chunk. */
  chunkId: string
  startMeasure: number
  endMeasure: number
  /** The last join, chunks 1..n, is the whole piece — a hard-locked run-through. */
  whole: boolean
  /** Chunk k is ready and the join before it (or chunk 1, for k = 2) is done. */
  available: boolean
  passed: boolean
  passedAt?: number
  /** Counted tries at this join that weren't ready. */
  misses: number
  seam: {
    /** Three join misses since the last seam drill: drill the seam before trying again. */
    offered: boolean
    /** Ready seam tries since it was offered (two finish it). */
    readies: number
    startMeasure: number
    endMeasure: number
  }
}

export type NextStep =
  | { kind: 'chunk'; idx: number; rung: ChunkRung; stuck: boolean }
  | { kind: 'join'; k: number; whole: boolean }
  | { kind: 'seam'; k: number }
  | { kind: 'complete' }

export interface PiecePath {
  chunks: ChunkState[]
  joins: JoinState[]
  next: NextStep
  readyChunkCount: number
  /** Every chunk is ready and the whole piece has been run through ready. */
  complete: boolean
  completedAt?: number
  /** The most recently readied chunk or passed join — what a warm-up or "end on a win" replays. */
  lastReadied?: PathItem & { at: number }
  /** Why the whole piece is still locked, or undefined once it's open. */
  wholeLock?: { remainingChunks: number[]; waitingForJoin?: number }
}

export interface PiecePathInput {
  /** Any order; sorted by idx here. */
  chunks: Chunk[]
  /** The piece's sections — only those tagged with a chunk are read. */
  sections: Section[]
  /** The piece's attempts, any order. */
  attempts: PathAttempt[]
  targetTempoBpm: number
  now: number
}

const SEAM_READIES_NEEDED = 2

function byTime(a: PathAttempt, b: PathAttempt): number {
  return a.timestamp - b.timestamp
}

function attemptsFor(sectionIds: Set<string>, attempts: PathAttempt[]): PathAttempt[] {
  return attempts.filter((a) => sectionIds.has(a.sectionId))
}

function sectionIdsFor(sections: Section[], chunkId: string, rung: Section['rung']): Set<string> {
  return new Set(sections.filter((s) => s.chunkId === chunkId && s.rung === rung).map((s) => s.id))
}

export function chunkRungAttempts(chunkId: string, sections: Section[], attempts: PathAttempt[]): ChunkRungAttempts {
  const sorted = [...attempts].sort(byTime)
  const handBySection = new Map(
    sections.filter((s) => s.chunkId === chunkId && s.rung === 'notes-hand').map((s) => [s.id, s.handFilter === 'left' ? 'left' : 'right'] as const),
  )
  return {
    notesHand: sorted.filter((a) => handBySection.has(a.sectionId)).map((a) => ({ ...a, hand: handBySection.get(a.sectionId)! })),
    notes: attemptsFor(sectionIdsFor(sections, chunkId, 'notes'), sorted),
    metronome: attemptsFor(sectionIdsFor(sections, chunkId, 'metronome'), sorted),
    tempo: attemptsFor(sectionIdsFor(sections, chunkId, 'tempo'), sorted),
  }
}

/** The two bars either side of the join between chunk k-1 and chunk k. */
export function seamRange(previous: Chunk, next: Chunk): { startMeasure: number; endMeasure: number } {
  return { startMeasure: previous.endMeasure, endMeasure: next.startMeasure }
}

function joinState(
  k: number,
  chunks: ChunkState[],
  previousJoin: JoinState | undefined,
  sections: Section[],
  attempts: PathAttempt[],
  targetTempoBpm: number,
): JoinState {
  const chunk = chunks[k - 1].chunk
  // Joins and seams are played at the target. A slower try (a "Slower"
  // offer taken) is practice on the way, neither a pass nor a miss.
  const atTarget = (a: PathAttempt) => !a.aborted && a.tempoBpm >= targetTempoBpm
  const joinAttempts = attemptsFor(sectionIdsFor(sections, chunk.id, 'join'), attempts).filter(atTarget)
  const seamAttempts = attemptsFor(sectionIdsFor(sections, chunk.id, 'seam'), attempts).filter(atTarget)
  const seam = seamRange(chunks[k - 2].chunk, chunk)

  // Walk join and seam tries together: three join misses open the seam
  // drill, two ready seam tries close it again, and the count starts over.
  const events = [...joinAttempts.map((a) => ({ a, join: true })), ...seamAttempts.map((a) => ({ a, join: false }))].sort((x, y) =>
    byTime(x.a, y.a),
  )
  let passedAt: number | undefined
  let misses = 0
  let missesSinceSeam = 0
  let seamOffered = false
  let seamReadies = 0
  for (const { a, join } of events) {
    if (a.aggregate.expected === 0) continue
    if (join) {
      if (isReadyAttempt(a)) {
        passedAt = a.timestamp
        break
      }
      misses++
      missesSinceSeam++
      if (missesSinceSeam >= STUCK_AFTER_TRIES && !seamOffered) {
        seamOffered = true
        seamReadies = 0
      }
    } else if (seamOffered && isReadyAttempt(a)) {
      seamReadies++
      if (seamReadies >= SEAM_READIES_NEEDED) {
        seamOffered = false
        missesSinceSeam = 0
      }
    }
  }

  const opener = k === 2 ? chunks[0].progress.ready : previousJoin?.passed === true
  return {
    k,
    chunkId: chunk.id,
    startMeasure: chunks[0].chunk.startMeasure,
    endMeasure: chunk.endMeasure,
    whole: k === chunks.length,
    available: chunks[k - 1].progress.ready && opener,
    passed: passedAt !== undefined,
    passedAt,
    misses,
    seam: { offered: passedAt === undefined && seamOffered, readies: seamReadies, ...seam },
  }
}

/**
 * The whole path for one piece, derived from its chunks and attempts:
 * each chunk's ladder (repeats mirroring their source), the snowball joins
 * (1+2, then 1–3, …, the last being the whole piece), and the single next
 * step. The next step is the first join that's open and not yet passed —
 * so a chunk is joined as soon as it's ready — else the lowest unpassed
 * rung of the earliest unready chunk.
 */
export function piecePath(input: PiecePathInput): PiecePath {
  const sortedChunks = [...input.chunks].sort((a, b) => a.idx - b.idx)
  const attempts = [...input.attempts].sort(byTime)
  const idxById = new Map(sortedChunks.map((c, i) => [c.id, i]))

  const own = sortedChunks.map((chunk) =>
    rungProgress(chunkRungAttempts(chunk.id, input.sections, attempts), input.targetTempoBpm, input.now),
  )
  const chunks: ChunkState[] = sortedChunks.map((chunk, i) => {
    const sourceIdx = chunk.repeatOfChunkId !== undefined ? idxById.get(chunk.repeatOfChunkId) : undefined
    return {
      chunk,
      number: i + 1,
      progress: sourceIdx !== undefined ? own[sourceIdx] : own[i],
      repeatOf: sourceIdx !== undefined ? sourceIdx + 1 : undefined,
    }
  })

  const joins: JoinState[] = []
  for (let k = 2; k <= chunks.length; k++) joins.push(joinState(k, chunks, joins.at(-1), input.sections, attempts, input.targetTempoBpm))

  const readyChunkCount = chunks.filter((c) => c.progress.ready).length
  const allReady = chunks.length > 0 && readyChunkCount === chunks.length

  let next: NextStep
  const openJoin = joins.find((j) => j.available && !j.passed)
  const unready = chunks.find((c) => !c.progress.ready)
  if (openJoin) {
    next = openJoin.seam.offered ? { kind: 'seam', k: openJoin.k } : { kind: 'join', k: openJoin.k, whole: openJoin.whole }
  } else if (unready) {
    const progress = unready.progress
    const rung = progress.current as ChunkRung
    const stuck = rung === 'notes' ? progress.rung2.stuck : rung === 'metronome' ? progress.rung3.stuck : progress.rung4.stuck
    next = { kind: 'chunk', idx: unready.chunk.idx, rung, stuck }
  } else {
    next = { kind: 'complete' }
  }

  const complete = allReady && (joins.length === 0 || joins[joins.length - 1].passed)
  const completedAt = complete ? (joins.length === 0 ? chunks[0]?.progress.readyAt : joins[joins.length - 1].passedAt) : undefined

  let lastReadied: PiecePath['lastReadied']
  for (const c of chunks) {
    if (c.repeatOf !== undefined || c.progress.readyAt === undefined) continue
    if (!lastReadied || c.progress.readyAt > lastReadied.at) lastReadied = { kind: 'chunk', idx: c.chunk.idx, at: c.progress.readyAt }
  }
  for (const j of joins) {
    if (j.passedAt !== undefined && (!lastReadied || j.passedAt >= lastReadied.at)) lastReadied = { kind: 'join', k: j.k, at: j.passedAt }
  }

  const finalJoin = joins.at(-1)
  const wholeLock =
    finalJoin && !finalJoin.available
      ? {
          remainingChunks: chunks.filter((c) => !c.progress.ready).map((c) => c.number),
          waitingForJoin: allReady ? joins.find((j) => !j.passed)?.k : undefined,
        }
      : undefined

  return { chunks, joins, next, readyChunkCount, complete, completedAt, lastReadied, wholeLock }
}

/** "chunk 3 · build tempo", "join 1–3", "whole piece" — the short name a step goes by on the plan and in headers. */
export function describeStep(step: NextStep): string {
  switch (step.kind) {
    case 'chunk':
      return `chunk ${step.idx + 1} · ${RUNG_NAME[step.rung]}`
    case 'join':
      return step.whole ? 'whole piece' : `join 1–${step.k}`
    case 'seam':
      return `seam ${step.k - 1}–${step.k}`
    case 'complete':
      return 'whole piece'
  }
}

export const RUNG_NAME: Record<ChunkRung, string> = {
  notes: 'notes',
  metronome: 'metronome',
  tempo: 'build tempo',
}

export function describeItem(item: PathItem, chunkCount: number): string {
  if (item.kind === 'chunk') return `chunk ${item.idx + 1}`
  return item.k === chunkCount ? 'whole piece' : item.k === 2 ? 'chunks 1 + 2' : `chunks 1–${item.k}`
}

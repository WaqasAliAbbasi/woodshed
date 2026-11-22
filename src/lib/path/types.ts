import type { Attempt } from '../db/db.ts'

/**
 * What a path section is for — stored on `sections.rung` (see schema.sql).
 * The path creates ordinary sections and attempts keep pointing at them, so
 * history and the MCP tools see them like any other practice; this tag is
 * what lets the path read its own attempts back out.
 *
 * - `notes-hand` — rung 1, Notes mode with one hand (optional).
 * - `notes` — rung 2, Notes mode with both hands.
 * - `metronome` — rung 3, Metronome mode at the start tempo.
 * - `tempo` — rung 4, Metronome mode, tempo set per try.
 * - `join` — Join 1–k (the last join is the whole piece), on chunk k.
 * - `seam` — the seam drill for the join on chunk k.
 * - `drill` — an offered shortcut (half a chunk, a shorter range). Never moves the path.
 * - `review` — a warm-up, win or weekly review run of something already ready. Never moves the path.
 */
export type PathRung = 'notes-hand' | 'notes' | 'metronome' | 'tempo' | 'join' | 'seam' | 'drill' | 'review'

export const PATH_RUNGS: readonly PathRung[] = ['notes-hand', 'notes', 'metronome', 'tempo', 'join', 'seam', 'drill', 'review']

export interface Chunk {
  id: string
  pieceId: string
  /** 0-based position in the piece; shown to the student as idx + 1. */
  idx: number
  startMeasure: number
  endMeasure: number
  /** Set when this chunk's notes are identical to an earlier chunk's — its status mirrors that one. */
  repeatOfChunkId?: string
  createdAt: number
}

/**
 * The slice of an attempt the path rules read. `noteResults` is optional
 * because the plan-wide overview omits it (see `/api/path/overview`); only
 * the weaker-hand guess needs it.
 */
export type PathAttempt = Pick<Attempt, 'id' | 'sectionId' | 'pieceId' | 'tempoBpm' | 'timestamp' | 'aborted' | 'aggregate'> &
  Partial<Pick<Attempt, 'durationMs' | 'noteResults' | 'sessionId'>>

export type LessonOutcome = 'finished' | 'continue' | 'new'

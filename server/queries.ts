import type { DatabaseSync } from 'node:sqlite'
import type { Attempt, Piece, Section } from '../src/lib/db/db.ts'
import { fromIntBoolean, nullToUndefined, toParam } from './db.ts'

/**
 * The shared data-access layer for both the REST API (server/routes/) and
 * the MCP tools (server/mcp.ts) — one place that knows the SQL schema and
 * the snake_case↔camelCase mapping, so the two surfaces can't drift into
 * disagreeing about what a "piece" or "attempt" looks like. Row types below
 * reuse the *same* `Piece`/`Section`/`Attempt` interfaces the client already
 * has (`src/lib/db/db.ts`) — type-only imports, erased at build/run time —
 * so the wire shape is guaranteed to match what the client's repo layer
 * expects without a parallel set of DTOs to keep in sync by hand.
 *
 * Every function here takes `userId` and every query is scoped by it — this
 * app is multi-user (see the `users` table in schema.sql), and this is the
 * one layer responsible for one user never being able to read or write
 * another's library. There is deliberately no "give me this row by id,
 * unscoped" function anywhere in this file — the temptation to add one for
 * convenience is exactly the shape of bug that leaks data across accounts.
 */

export type PieceSummary = Omit<Piece, 'musicXml'>
export type AttemptSummary = Pick<Attempt, 'pieceId' | 'timestamp' | 'durationMs'>

interface PieceRow {
  id: string
  title: string
  composer: string | null
  filename: string
  music_xml: string
  created_at: number
  updated_at: number
  measure_count: number
}

function pieceFromRow(row: PieceRow): Piece {
  return {
    id: row.id,
    title: row.title,
    composer: nullToUndefined(row.composer),
    filename: row.filename,
    musicXml: row.music_xml,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    measureCount: row.measure_count,
  }
}

const PIECE_SUMMARY_COLUMNS = 'id, title, composer, filename, created_at, updated_at, measure_count'

function pieceSummaryFromRow(row: Omit<PieceRow, 'music_xml'>): PieceSummary {
  return {
    id: row.id,
    title: row.title,
    composer: nullToUndefined(row.composer),
    filename: row.filename,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    measureCount: row.measure_count,
  }
}

export function listPieceSummaries(db: DatabaseSync, userId: string): PieceSummary[] {
  const rows = db
    .prepare(`SELECT ${PIECE_SUMMARY_COLUMNS} FROM pieces WHERE user_id = ? ORDER BY created_at`)
    .all(userId) as unknown as Omit<PieceRow, 'music_xml'>[]
  return rows.map(pieceSummaryFromRow)
}

export function getPiece(db: DatabaseSync, userId: string, id: string): Piece | undefined {
  const row = db.prepare('SELECT * FROM pieces WHERE id = ? AND user_id = ?').get(id, userId) as unknown as PieceRow | undefined
  return row ? pieceFromRow(row) : undefined
}

/** True if `pieceId` exists and is owned by `userId` — the ownership check every route touching a piece's children (sections, attempts) runs before trusting a piece id from the request. */
export function ownsPiece(db: DatabaseSync, userId: string, pieceId: string): boolean {
  return db.prepare('SELECT 1 FROM pieces WHERE id = ? AND user_id = ?').get(pieceId, userId) !== undefined
}

export function createPiece(db: DatabaseSync, userId: string, piece: Piece): void {
  db.prepare(
    `INSERT INTO pieces (id, user_id, title, composer, filename, music_xml, created_at, updated_at, measure_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, composer = excluded.composer, filename = excluded.filename,
       music_xml = excluded.music_xml, updated_at = excluded.updated_at, measure_count = excluded.measure_count
     WHERE pieces.user_id = excluded.user_id`,
  ).run(
    piece.id,
    userId,
    piece.title,
    toParam(piece.composer),
    piece.filename,
    piece.musicXml,
    piece.createdAt,
    piece.updatedAt,
    piece.measureCount,
  )
}

export function renamePiece(db: DatabaseSync, userId: string, id: string, title: string): PieceSummary | undefined {
  const updatedAt = Date.now()
  const result = db.prepare('UPDATE pieces SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
    title,
    updatedAt,
    id,
    userId,
  )
  if (result.changes === 0) return undefined
  return getPieceSummary(db, userId, id)
}

export function getPieceSummary(db: DatabaseSync, userId: string, id: string): PieceSummary | undefined {
  const row = db.prepare(`SELECT ${PIECE_SUMMARY_COLUMNS} FROM pieces WHERE id = ? AND user_id = ?`).get(id, userId) as unknown as
    | Omit<PieceRow, 'music_xml'>
    | undefined
  return row ? pieceSummaryFromRow(row) : undefined
}

/** Relies on `ON DELETE CASCADE` (pieces → sections → attempts, see schema.sql) for the rest — one statement instead of the client's old hand-rolled three-store transaction. */
export function deletePiece(db: DatabaseSync, userId: string, id: string): boolean {
  return db.prepare('DELETE FROM pieces WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
}

interface SectionRow {
  id: string
  piece_id: string
  label: string
  start_measure: number
  end_measure: number
  default_tempo_bpm: number
  created_at: number
  hand_filter: string | null
  mode: string | null
}

function sectionFromRow(row: SectionRow): Section {
  return {
    id: row.id,
    pieceId: row.piece_id,
    label: row.label,
    startMeasure: row.start_measure,
    endMeasure: row.end_measure,
    defaultTempoBpm: row.default_tempo_bpm,
    createdAt: row.created_at,
    handFilter: nullToUndefined(row.hand_filter) as Section['handFilter'],
    mode: nullToUndefined(row.mode) as Section['mode'],
  }
}

export function listSectionsForPiece(db: DatabaseSync, userId: string, pieceId: string): Section[] {
  const rows = db.prepare('SELECT * FROM sections WHERE piece_id = ? AND user_id = ?').all(pieceId, userId) as unknown as SectionRow[]
  return rows.map(sectionFromRow)
}

export function getSection(db: DatabaseSync, userId: string, id: string): Section | undefined {
  const row = db.prepare('SELECT * FROM sections WHERE id = ? AND user_id = ?').get(id, userId) as unknown as SectionRow | undefined
  return row ? sectionFromRow(row) : undefined
}

/** Caller (routes/sections.ts) must already have verified `section.pieceId` is owned by `userId` — see `ownsPiece` — before calling this; it does not re-check. */
export function createSection(db: DatabaseSync, userId: string, section: Section): void {
  db.prepare(
    `INSERT INTO sections (id, user_id, piece_id, label, start_measure, end_measure, default_tempo_bpm, created_at, hand_filter, mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    section.id,
    userId,
    section.pieceId,
    section.label,
    section.startMeasure,
    section.endMeasure,
    section.defaultTempoBpm,
    section.createdAt,
    toParam(section.handFilter),
    toParam(section.mode),
  )
}

export function deleteSection(db: DatabaseSync, userId: string, id: string): boolean {
  return db.prepare('DELETE FROM sections WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
}

interface AttemptRow {
  id: string
  section_id: string
  piece_id: string
  tempo_bpm: number
  timestamp: number
  aborted: number
  duration_ms: number | null
  aggregate: string
  note_results: string
}

function attemptFromRow(row: AttemptRow): Attempt {
  return {
    id: row.id,
    sectionId: row.section_id,
    pieceId: row.piece_id,
    tempoBpm: row.tempo_bpm,
    timestamp: row.timestamp,
    aborted: fromIntBoolean(row.aborted),
    durationMs: nullToUndefined(row.duration_ms),
    aggregate: JSON.parse(row.aggregate) as Attempt['aggregate'],
    noteResults: JSON.parse(row.note_results) as Attempt['noteResults'],
  }
}

export function listAttemptsForSection(db: DatabaseSync, userId: string, sectionId: string): Attempt[] {
  const rows = db
    .prepare('SELECT * FROM attempts WHERE section_id = ? AND user_id = ? ORDER BY timestamp')
    .all(sectionId, userId) as unknown as AttemptRow[]
  return rows.map(attemptFromRow)
}

export function listAttemptsForPiece(db: DatabaseSync, userId: string, pieceId: string): Attempt[] {
  const rows = db
    .prepare('SELECT * FROM attempts WHERE piece_id = ? AND user_id = ? ORDER BY timestamp')
    .all(pieceId, userId) as unknown as AttemptRow[]
  return rows.map(attemptFromRow)
}

/** Every attempt across the whole library, trimmed to what `buildPieceStatsMap`/`computeStreak` actually read — see the payload-size reasoning in the plan for why this doesn't return full `Attempt[]` the way the per-piece/per-section listings do. */
export function listAttemptSummaries(db: DatabaseSync, userId: string): AttemptSummary[] {
  const rows = db.prepare('SELECT piece_id, timestamp, duration_ms FROM attempts WHERE user_id = ? ORDER BY timestamp').all(
    userId,
  ) as unknown as { piece_id: string; timestamp: number; duration_ms: number | null }[]
  return rows.map((row) => ({ pieceId: row.piece_id, timestamp: row.timestamp, durationMs: nullToUndefined(row.duration_ms) }))
}

/**
 * Upserts by id — the outbox flush (see `src/lib/db/attemptsRepo.ts`)
 * retries blindly on a network failure, so a duplicate POST of an
 * already-stored attempt must be a no-op, not a duplicate row or an error.
 * Caller (routes/attempts.ts) must already have verified `attempt.pieceId`
 * is owned by `userId` before calling this; it does not re-check.
 */
export function recordAttempt(db: DatabaseSync, userId: string, attempt: Attempt): void {
  db.prepare(
    `INSERT INTO attempts (id, user_id, section_id, piece_id, tempo_bpm, timestamp, aborted, duration_ms, aggregate, note_results)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(
    attempt.id,
    userId,
    attempt.sectionId,
    attempt.pieceId,
    attempt.tempoBpm,
    attempt.timestamp,
    toParam(attempt.aborted),
    toParam(attempt.durationMs),
    JSON.stringify(attempt.aggregate),
    JSON.stringify(attempt.noteResults),
  )
}

export function deleteAttempt(db: DatabaseSync, userId: string, id: string): boolean {
  return db.prepare('DELETE FROM attempts WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
}

export interface PieceOverview {
  id: string
  title: string
  composer: string | undefined
  measureCount: number
  lastPracticedAt: number | undefined
}

/** For the MCP `list_pieces` tool — a piece summary plus its last-practiced timestamp, which the REST piece-library list computes client-side instead (from `/api/attempts/summary`, see `pieceStats.ts`) since the UI needs the full recency sort, not just one figure per piece. */
export function listPieceOverviews(db: DatabaseSync, userId: string): PieceOverview[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.title, p.composer, p.measure_count, MAX(a.timestamp) AS last_practiced_at
       FROM pieces p
       LEFT JOIN attempts a ON a.piece_id = p.id
       WHERE p.user_id = ?
       GROUP BY p.id
       ORDER BY p.created_at`,
    )
    .all(userId) as unknown as { id: string; title: string; composer: string | null; measure_count: number; last_practiced_at: number | null }[]
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    composer: nullToUndefined(row.composer),
    measureCount: row.measure_count,
    lastPracticedAt: nullToUndefined(row.last_practiced_at),
  }))
}

export interface RecentAttempt {
  timestamp: number
  pieceTitle: string
  sectionLabel: string
  tempoBpm: number
  aborted: boolean
  pitchAccuracy: number
  timingAccuracy: number
}

/**
 * Recent attempts joined with piece/section labels — the one query written
 * for the MCP `practice_history` tool (see mcp.ts) rather than the REST
 * API, which never needs "recent across the whole library, human-readable"
 * in one shot; the UI already has the piece/section objects in hand from
 * its own per-piece fetches.
 */
export function listRecentAttempts(
  db: DatabaseSync,
  userId: string,
  options: { pieceId?: string; limit: number },
): RecentAttempt[] {
  const pieceFilter = options.pieceId ? 'AND a.piece_id = ?' : ''
  const params = options.pieceId ? [userId, options.pieceId, options.limit] : [userId, options.limit]
  const rows = db
    .prepare(
      `SELECT a.timestamp, p.title AS piece_title, s.label AS section_label, a.tempo_bpm, a.aborted, a.aggregate
       FROM attempts a
       JOIN pieces p ON p.id = a.piece_id
       JOIN sections s ON s.id = a.section_id
       WHERE a.user_id = ? ${pieceFilter}
       ORDER BY a.timestamp DESC
       LIMIT ?`,
    )
    .all(...params) as unknown as {
    timestamp: number
    piece_title: string
    section_label: string
    tempo_bpm: number
    aborted: number
    aggregate: string
  }[]
  return rows.map((row) => {
    const aggregate = JSON.parse(row.aggregate) as Attempt['aggregate']
    return {
      timestamp: row.timestamp,
      pieceTitle: row.piece_title,
      sectionLabel: row.section_label,
      tempoBpm: row.tempo_bpm,
      aborted: fromIntBoolean(row.aborted),
      pitchAccuracy: aggregate.pitchAccuracy,
      timingAccuracy: aggregate.timingAccuracy,
    }
  })
}

/** Full three-store snapshot for one user, in the shape `src/lib/db/export.ts` produces — the server-side half of the export/import/backup story. */
export function exportAll(db: DatabaseSync, userId: string): { pieces: Piece[]; sections: Section[]; attempts: Attempt[] } {
  const pieces = (db.prepare('SELECT * FROM pieces WHERE user_id = ?').all(userId) as unknown as PieceRow[]).map(pieceFromRow)
  const sections = (db.prepare('SELECT * FROM sections WHERE user_id = ?').all(userId) as unknown as SectionRow[]).map(sectionFromRow)
  const attempts = (db.prepare('SELECT * FROM attempts WHERE user_id = ?').all(userId) as unknown as AttemptRow[]).map(attemptFromRow)
  return { pieces, sections, attempts }
}

/**
 * Bulk upsert for the one-time "upload my local history" migration and for
 * restoring a backup — everything in `doc` is attributed to `userId`
 * regardless of what it looked like in the source browser's IndexedDB
 * (which has no concept of users at all). Every record keyed by its
 * existing id, same idempotency guarantee as `recordAttempt`. Runs as one
 * transaction so a mid-import failure doesn't leave the library half-migrated.
 */
export function importAll(
  db: DatabaseSync,
  userId: string,
  doc: { pieces: Piece[]; sections: Section[]; attempts: Attempt[] },
): void {
  db.exec('BEGIN')
  try {
    for (const piece of doc.pieces) createPiece(db, userId, piece)
    for (const section of doc.sections) createSection(db, userId, section)
    for (const attempt of doc.attempts) recordAttempt(db, userId, attempt)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

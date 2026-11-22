import type { DatabaseSync } from 'node:sqlite'
import type { Attempt, Piece, PracticeSession, Section } from '../src/lib/db/db.ts'
import type { ChunkPlan } from '../src/lib/path/chunkPiece.ts'
import { PATH_RUNGS, type Chunk, type LessonOutcome, type PathAttempt, type PathRung } from '../src/lib/path/types.ts'
import { attemptWindow, clusterWindows, mergeWindows, SESSION_GAP_MS, type PracticeWindow } from '../src/lib/sessions.ts'
import { generateId } from '../src/lib/id.ts'
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
  target_tempo_bpm: number | null
  finished_at: number | null
  new_measure_count: number | null
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
    targetTempoBpm: nullToUndefined(row.target_tempo_bpm),
    finishedAt: nullToUndefined(row.finished_at),
    newMeasureCount: nullToUndefined(row.new_measure_count),
  }
}

const PIECE_SUMMARY_COLUMNS =
  'id, title, composer, filename, created_at, updated_at, measure_count, target_tempo_bpm, finished_at, new_measure_count'

function pieceSummaryFromRow(row: Omit<PieceRow, 'music_xml'>): PieceSummary {
  return {
    id: row.id,
    title: row.title,
    composer: nullToUndefined(row.composer),
    filename: row.filename,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    measureCount: row.measure_count,
    targetTempoBpm: nullToUndefined(row.target_tempo_bpm),
    finishedAt: nullToUndefined(row.finished_at),
    newMeasureCount: nullToUndefined(row.new_measure_count),
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
    `INSERT INTO pieces (id, user_id, title, composer, filename, music_xml, created_at, updated_at, measure_count, target_tempo_bpm)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    toParam(piece.targetTempoBpm),
  )
}

/** `composer: undefined` leaves it unchanged; pass `null` explicitly to clear it. */
export function updatePiece(
  db: DatabaseSync,
  userId: string,
  id: string,
  updates: { title: string; composer?: string | null },
): PieceSummary | undefined {
  const updatedAt = Date.now()
  const result =
    updates.composer === undefined
      ? db
          .prepare('UPDATE pieces SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?')
          .run(updates.title, updatedAt, id, userId)
      : db
          .prepare('UPDATE pieces SET title = ?, composer = ?, updated_at = ? WHERE id = ? AND user_id = ?')
          .run(updates.title, toParam(updates.composer), updatedAt, id, userId)
  if (result.changes === 0) return undefined
  return getPieceSummary(db, userId, id)
}

/**
 * Sets the tempo the student is working this piece up to. Separate from
 * {@link updatePiece} rather than another optional field on it: that one is
 * the rename path and requires a title, which a tempo change has no
 * business supplying.
 */
export function updatePieceTargetTempo(
  db: DatabaseSync,
  userId: string,
  id: string,
  targetTempoBpm: number,
): PieceSummary | undefined {
  const result = db
    .prepare('UPDATE pieces SET target_tempo_bpm = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(targetTempoBpm, Date.now(), id, userId)
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
  chunk_id: string | null
  rung: string | null
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
    chunkId: nullToUndefined(row.chunk_id),
    rung: nullToUndefined(row.rung) as Section['rung'],
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

/** Caller (routes/sections.ts) must already have verified `section.pieceId` is owned by `userId` — see `ownsPiece` — and, for a path section, that `section.chunkId` is one of that piece's chunks (`chunkBelongsToPiece`), before calling this; it does not re-check. */
export function createSection(db: DatabaseSync, userId: string, section: Section): void {
  db.prepare(
    `INSERT INTO sections (id, user_id, piece_id, label, start_measure, end_measure, default_tempo_bpm, created_at, hand_filter, mode, chunk_id, rung)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    toParam(section.chunkId),
    toParam(section.rung),
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
  session_id: string | null
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
    sessionId: nullToUndefined(row.session_id),
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
 *
 * Assigns the attempt to a practice session (creating or merging derived
 * sessions as needed — see `assignAttemptToSession`) *before* inserting,
 * so the row is written with `session_id` set in one pass rather than a
 * later backfill sweep. Checked for an existing row first and skipped
 * entirely on a duplicate delivery: re-running assignment for an attempt
 * already clustered into a session would be redundant at best, and at
 * worst double-counts it if the retried POST arrives after the user has
 * since edited that session's note.
 */
export function recordAttempt(db: DatabaseSync, userId: string, attempt: Attempt): void {
  const alreadyStored = db.prepare('SELECT 1 FROM attempts WHERE id = ?').get(attempt.id) !== undefined
  if (alreadyStored) return

  const sessionId = assignAttemptToSession(db, userId, attemptWindow(attempt))
  db.prepare(
    `INSERT INTO attempts (id, user_id, section_id, piece_id, tempo_bpm, timestamp, aborted, duration_ms, aggregate, note_results, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    sessionId,
  )
}

export function deleteAttempt(db: DatabaseSync, userId: string, id: string): boolean {
  return db.prepare('DELETE FROM attempts WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
}

// ---------------------------------------------------------------------
// Practice sessions — see schema.sql's `practice_sessions` doc comment and
// docs/sessions-plan.md for the derived/manual distinction and why
// clustering runs at write time rather than being computed on every read.
// ---------------------------------------------------------------------

interface PracticeSessionRow {
  id: string
  started_at: number
  ended_at: number
  source: string
  label: string | null
  piece_id: string | null
  note: string | null
  created_at: number
  updated_at: number
}

interface SessionAggregates {
  attemptCount: number
  scoredMs: number
  pieceIds: string[]
}

function practiceSessionFromRow(row: PracticeSessionRow, aggregates: SessionAggregates): PracticeSession {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    source: row.source as PracticeSession['source'],
    label: nullToUndefined(row.label),
    pieceId: nullToUndefined(row.piece_id),
    note: nullToUndefined(row.note),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attemptCount: aggregates.attemptCount,
    scoredMs: aggregates.scoredMs,
    pieceIds: aggregates.pieceIds,
  }
}

/**
 * Attaches attempt-derived aggregates (count, scored time, distinct pieces
 * touched, first-touched order) to a batch of session rows in two grouped
 * queries rather than one query per row, and rather than a single query
 * using SQLite's `GROUP_CONCAT(... ORDER BY ...)` — that syntax needs
 * SQLite 3.44+, and `node:sqlite` is still an experimental Node API (see
 * db.ts's own doc comment) whose bundled SQLite version isn't worth
 * pinning a query to. A manual session's aggregates are never queried at
 * all — it has no attempts by construction (schema.sql) — so its numbers
 * are always zero, with its own `pieceId` (if any) as the sole entry in
 * `pieceIds`.
 */
function hydrateSessions(db: DatabaseSync, userId: string, rows: PracticeSessionRow[]): PracticeSession[] {
  if (rows.length === 0) return []
  const derivedIds = rows.filter((r) => r.source === 'derived').map((r) => r.id)

  const countBySession = new Map<string, { attemptCount: number; scoredMs: number }>()
  const pieceIdsBySession = new Map<string, string[]>()

  if (derivedIds.length > 0) {
    const placeholders = derivedIds.map(() => '?').join(',')
    const countRows = db
      .prepare(
        `SELECT session_id, COUNT(*) AS attempt_count, SUM(duration_ms) AS scored_ms
         FROM attempts WHERE user_id = ? AND session_id IN (${placeholders}) GROUP BY session_id`,
      )
      .all(userId, ...derivedIds) as unknown as { session_id: string; attempt_count: number; scored_ms: number | null }[]
    for (const row of countRows) {
      countBySession.set(row.session_id, { attemptCount: row.attempt_count, scoredMs: row.scored_ms ?? 0 })
    }

    const pieceRows = db
      .prepare(
        `SELECT session_id, piece_id, MIN(timestamp) AS first_ts
         FROM attempts WHERE user_id = ? AND session_id IN (${placeholders})
         GROUP BY session_id, piece_id ORDER BY session_id, first_ts`,
      )
      .all(userId, ...derivedIds) as unknown as { session_id: string; piece_id: string; first_ts: number }[]
    for (const row of pieceRows) {
      const list = pieceIdsBySession.get(row.session_id)
      if (list) list.push(row.piece_id)
      else pieceIdsBySession.set(row.session_id, [row.piece_id])
    }
  }

  return rows.map((row) => {
    if (row.source === 'manual') {
      return practiceSessionFromRow(row, { attemptCount: 0, scoredMs: 0, pieceIds: row.piece_id ? [row.piece_id] : [] })
    }
    const counts = countBySession.get(row.id) ?? { attemptCount: 0, scoredMs: 0 }
    return practiceSessionFromRow(row, { ...counts, pieceIds: pieceIdsBySession.get(row.id) ?? [] })
  })
}

/** Newest-first, optionally trimmed to sessions started on or after `since` and/or capped at `limit`. */
export function listSessions(
  db: DatabaseSync,
  userId: string,
  options: { since?: number; limit?: number } = {},
): PracticeSession[] {
  const conditions = ['user_id = ?']
  const params: (string | number)[] = [userId]
  if (options.since !== undefined) {
    conditions.push('started_at >= ?')
    params.push(options.since)
  }
  const limitClause = options.limit !== undefined ? 'LIMIT ?' : ''
  if (options.limit !== undefined) params.push(options.limit)

  const rows = db
    .prepare(`SELECT * FROM practice_sessions WHERE ${conditions.join(' AND ')} ORDER BY started_at DESC ${limitClause}`)
    .all(...params) as unknown as PracticeSessionRow[]
  return hydrateSessions(db, userId, rows)
}

/** What the export endpoint serves: when, how long, which pieces (by title). Newest first. */
export function exportSessions(db: DatabaseSync, userId: string, since?: number) {
  const sessions = listSessions(db, userId, { since })
  const titles = new Map(
    (db.prepare('SELECT id, title FROM pieces WHERE user_id = ?').all(userId) as unknown as { id: string; title: string }[]).map((p) => [p.id, p.title]),
  )
  return sessions.map((s) => ({
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    source: s.source,
    label: s.label,
    attemptCount: s.attemptCount,
    scoredMs: s.scoredMs,
    pieces: s.pieceIds.flatMap((id) => titles.get(id) ?? []),
  }))
}

export function getSession(db: DatabaseSync, userId: string, id: string): PracticeSession | undefined {
  const row = db.prepare('SELECT * FROM practice_sessions WHERE id = ? AND user_id = ?').get(id, userId) as unknown as
    | PracticeSessionRow
    | undefined
  return row ? hydrateSessions(db, userId, [row])[0] : undefined
}

/** A stand-in id for the attempt being placed, alongside real session ids, in the one `clusterWindows` call `assignAttemptToSession` makes — see its doc comment. Never collides with a real id (`generateId()` never produces this literal). */
const NEW_ATTEMPT_MARKER = '__new_attempt__'

/**
 * Finds or creates the derived `practice_sessions` row this attempt's
 * window belongs to, merging existing derived sessions together if the
 * attempt bridges more than one — the case that makes out-of-order
 * delivery (a retried outbox POST, or an older attempt from another
 * browser's outbox landing late) correct instead of splitting one sitting
 * into two sessions depending on network timing. Manual sessions are never
 * candidates: they describe practice Woodshed didn't witness and never
 * absorb attempts (see schema.sql).
 *
 * Bounds the candidate query to sessions within `SESSION_GAP_MS` of the
 * attempt's window — anything further away can't cluster regardless of
 * what else exists in the user's history, so there's no need to scan every
 * session they've ever had. Reuses `clusterWindows` (`src/lib/sessions.ts`)
 * — the same primitive `backfillSessions` runs old data through below — by
 * treating the attempt as one more window alongside the candidates and
 * reading off whichever cluster it landed in.
 */
function assignAttemptToSession(db: DatabaseSync, userId: string, window: PracticeWindow): string {
  const candidates = db
    .prepare(
      `SELECT id, started_at, ended_at FROM practice_sessions
       WHERE user_id = ? AND source = 'derived' AND ended_at >= ? AND started_at <= ?`,
    )
    .all(userId, window.startedAt - SESSION_GAP_MS, window.endedAt + SESSION_GAP_MS) as unknown as {
    id: string
    started_at: number
    ended_at: number
  }[]

  const items = [
    ...candidates.map((c) => ({ id: c.id, startedAt: c.started_at, endedAt: c.ended_at })),
    { id: NEW_ATTEMPT_MARKER, ...window },
  ]
  const cluster = clusterWindows(items).find((c) => c.some((item) => item.id === NEW_ATTEMPT_MARKER))
  /* istanbul ignore next -- the attempt's own window is always in `items`, so clusterWindows always places it in some cluster */
  if (!cluster) throw new Error('assignAttemptToSession: clusterWindows dropped the attempt being assigned')

  const merged = cluster.reduce<PracticeWindow>((acc, w) => mergeWindows(acc, w), cluster[0])
  const existingSessions = cluster.filter((item) => item.id !== NEW_ATTEMPT_MARKER)
  const now = Date.now()

  if (existingSessions.length === 0) {
    const id = generateId()
    db.prepare(
      `INSERT INTO practice_sessions (id, user_id, started_at, ended_at, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'derived', ?, ?)`,
    ).run(id, userId, merged.startedAt, merged.endedAt, now, now)
    return id
  }

  // Usually exactly one. More than one means this attempt bridges sessions
  // that were previously too far apart to have clustered together — merge
  // the rest into the earliest-started one, so a session's identity (and
  // any note already on it) survives being "the" session for this stretch
  // instead of arbitrarily picking whichever row the query happened to
  // return first.
  const primary = existingSessions.slice().sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))[0]
  db.prepare('UPDATE practice_sessions SET started_at = ?, ended_at = ?, updated_at = ? WHERE id = ?').run(
    merged.startedAt,
    merged.endedAt,
    now,
    primary.id,
  )

  for (const other of existingSessions) {
    if (other.id === primary.id) continue
    db.prepare('UPDATE attempts SET session_id = ? WHERE session_id = ?').run(primary.id, other.id)
    // Carry the absorbed session's note onto the survivor rather than
    // silently dropping it — a merge is rare, but losing a note the
    // student wrote is a worse outcome than a slightly redundant one.
    const absorbedNote = (
      db.prepare('SELECT note FROM practice_sessions WHERE id = ?').get(other.id) as { note: string | null } | undefined
    )?.note
    if (absorbedNote) {
      const primaryNote = (
        db.prepare('SELECT note FROM practice_sessions WHERE id = ?').get(primary.id) as { note: string | null } | undefined
      )?.note
      const combinedNote = [primaryNote, absorbedNote].filter((n): n is string => Boolean(n)).join('\n\n')
      db.prepare('UPDATE practice_sessions SET note = ? WHERE id = ?').run(combinedNote, primary.id)
    }
    db.prepare('DELETE FROM practice_sessions WHERE id = ?').run(other.id)
  }

  return primary.id
}

/**
 * Runs once at boot (see server/index.ts, right after `openDb`) to assign
 * every attempt recorded before session clustering existed to a session —
 * the data-level expand step to go with `attempts.session_id` in
 * `ADDED_COLUMNS` (db.ts), which only adds the empty column. Safe to
 * re-run: it only ever touches rows where `session_id IS NULL`, and
 * `recordAttempt` always sets it going forward, so every boot after the
 * first successful one is a fast no-op query.
 *
 * Walks each user's pending attempts oldest-first through the exact same
 * `assignAttemptToSession` a live-recorded attempt goes through, rather
 * than a separate batch-clustering pass — so there is exactly one
 * definition of "what counts as one session" for old and new data alike.
 */
export function backfillSessions(db: DatabaseSync): void {
  const userIds = db.prepare('SELECT DISTINCT user_id FROM attempts WHERE session_id IS NULL').all() as unknown as {
    user_id: string
  }[]
  for (const { user_id: userId } of userIds) {
    const pending = db
      .prepare('SELECT id, timestamp, duration_ms FROM attempts WHERE user_id = ? AND session_id IS NULL ORDER BY timestamp')
      .all(userId) as unknown as { id: string; timestamp: number; duration_ms: number | null }[]
    for (const attempt of pending) {
      const window = attemptWindow({ timestamp: attempt.timestamp, durationMs: nullToUndefined(attempt.duration_ms) })
      const sessionId = assignAttemptToSession(db, userId, window)
      db.prepare('UPDATE attempts SET session_id = ? WHERE id = ?').run(sessionId, attempt.id)
    }
  }
}

/** Practice Woodshed didn't witness — a date/time, a length, and whatever the student wants to name and say about it. `pieceId`, if given, must already be owned by `userId` (caller's responsibility — see routes/sessions.ts, same pattern as `createSection`'s doc comment). */
export function createManualSession(
  db: DatabaseSync,
  userId: string,
  input: { startedAt: number; endedAt: number; label?: string; pieceId?: string; note?: string },
): PracticeSession {
  const id = generateId()
  const now = Date.now()
  db.prepare(
    `INSERT INTO practice_sessions (id, user_id, started_at, ended_at, source, label, piece_id, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)`,
  ).run(id, userId, input.startedAt, input.endedAt, toParam(input.label), toParam(input.pieceId), toParam(input.note), now, now)
  return getSession(db, userId, id)!
}

/**
 * `note`/`label`/`pieceId` can be edited on either kind of session — the
 * whole point of a session being a stored row is giving even automatically
 * clustered practice somewhere to hang a note (see docs/sessions-plan.md).
 * `startedAt`/`endedAt` are accepted here but callers (routes/sessions.ts)
 * only ever pass them for a manual session — a derived session's times are
 * owned by `assignAttemptToSession`, and a manual edit to them would just
 * be silently overwritten the next time an attempt lands nearby.
 */
export function updateSession(
  db: DatabaseSync,
  userId: string,
  id: string,
  updates: { note?: string | null; label?: string | null; pieceId?: string | null; startedAt?: number; endedAt?: number },
): PracticeSession | undefined {
  const owned = db.prepare('SELECT 1 FROM practice_sessions WHERE id = ? AND user_id = ?').get(id, userId) !== undefined
  if (!owned) return undefined

  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (updates.note !== undefined) {
    sets.push('note = ?')
    params.push(updates.note)
  }
  if (updates.label !== undefined) {
    sets.push('label = ?')
    params.push(updates.label)
  }
  if (updates.pieceId !== undefined) {
    sets.push('piece_id = ?')
    params.push(updates.pieceId)
  }
  if (updates.startedAt !== undefined) {
    sets.push('started_at = ?')
    params.push(updates.startedAt)
  }
  if (updates.endedAt !== undefined) {
    sets.push('ended_at = ?')
    params.push(updates.endedAt)
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?')
    params.push(Date.now())
    db.prepare(`UPDATE practice_sessions SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params, id, userId)
  }
  return getSession(db, userId, id)
}

/**
 * Manual sessions only — enforced in the query itself, not just by the
 * route, since this is the one place a delete could otherwise slip
 * through. Deleting a derived session would just recreate it (the next
 * attempt that lands nearby, or the next backfill), so there's nothing for
 * a derived delete to mean; routes/sessions.ts offers clearing its note
 * instead.
 */
export function deleteSession(db: DatabaseSync, userId: string, id: string): boolean {
  return db.prepare("DELETE FROM practice_sessions WHERE id = ? AND user_id = ? AND source = 'manual'").run(id, userId).changes > 0
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
  pieceId: string
  pieceTitle: string
  sectionId: string
  sectionLabel: string
  startMeasure: number
  endMeasure: number
  tempoBpm: number
  aborted: boolean
  durationMs: number | undefined
  /** Absent on sections created before Notes mode — treat as 'metronome', same as everywhere else. */
  mode: Section['mode']
  /** Absent on sections created before hands-separate practice — treat as 'both'. */
  handFilter: Section['handFilter']
  /**
   * The whole aggregate rather than the two accuracy figures this used to
   * flatten out: which of them actually *mean* anything depends on the
   * section's mode (a completed Notes-mode attempt is 100% pitch-accurate
   * by construction — see SequenceMatcher), so picking them is a judgement
   * the MCP layer makes, not a shape this query should be hardcoding.
   */
  aggregate: Attempt['aggregate']
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
      `SELECT a.timestamp, a.piece_id, p.title AS piece_title, a.section_id, s.label AS section_label,
              s.start_measure, s.end_measure, s.mode, s.hand_filter,
              a.tempo_bpm, a.aborted, a.duration_ms, a.aggregate
       FROM attempts a
       JOIN pieces p ON p.id = a.piece_id
       JOIN sections s ON s.id = a.section_id
       WHERE a.user_id = ? ${pieceFilter}
       ORDER BY a.timestamp DESC
       LIMIT ?`,
    )
    .all(...params) as unknown as {
    timestamp: number
    piece_id: string
    piece_title: string
    section_id: string
    section_label: string
    start_measure: number
    end_measure: number
    mode: string | null
    hand_filter: string | null
    tempo_bpm: number
    aborted: number
    duration_ms: number | null
    aggregate: string
  }[]
  return rows.map((row) => ({
    timestamp: row.timestamp,
    pieceId: row.piece_id,
    pieceTitle: row.piece_title,
    sectionId: row.section_id,
    sectionLabel: row.section_label,
    startMeasure: row.start_measure,
    endMeasure: row.end_measure,
    tempoBpm: row.tempo_bpm,
    aborted: fromIntBoolean(row.aborted),
    durationMs: nullToUndefined(row.duration_ms),
    mode: nullToUndefined(row.mode) as Section['mode'],
    handFilter: nullToUndefined(row.hand_filter) as Section['handFilter'],
    aggregate: JSON.parse(row.aggregate) as Attempt['aggregate'],
  }))
}

// ---------------------------------------------------------------------
// Learning path — see docs/learning-path.md and src/lib/path/. Chunks,
// collections and lessons are stored; rung progress never is (it's derived
// client-side from attempts on sections tagged with a chunk).
// ---------------------------------------------------------------------

interface ChunkRow {
  id: string
  piece_id: string
  idx: number
  start_measure: number
  end_measure: number
  repeat_of_chunk_id: string | null
  created_at: number
}

function chunkFromRow(row: ChunkRow): Chunk {
  return {
    id: row.id,
    pieceId: row.piece_id,
    idx: row.idx,
    startMeasure: row.start_measure,
    endMeasure: row.end_measure,
    repeatOfChunkId: nullToUndefined(row.repeat_of_chunk_id),
    createdAt: row.created_at,
  }
}

export function listChunksForPiece(db: DatabaseSync, userId: string, pieceId: string): Chunk[] {
  const rows = db
    .prepare('SELECT * FROM chunks WHERE piece_id = ? AND user_id = ? ORDER BY idx')
    .all(pieceId, userId) as unknown as ChunkRow[]
  return rows.map(chunkFromRow)
}

export function listChunks(db: DatabaseSync, userId: string): Chunk[] {
  const rows = db.prepare('SELECT * FROM chunks WHERE user_id = ? ORDER BY piece_id, idx').all(userId) as unknown as ChunkRow[]
  return rows.map(chunkFromRow)
}

/** True if `chunkId` is one of `pieceId`'s chunks and owned by `userId` — what a path section's chunk id is checked against before it's stored. */
export function chunkBelongsToPiece(db: DatabaseSync, userId: string, chunkId: string, pieceId: string): boolean {
  return db.prepare('SELECT 1 FROM chunks WHERE id = ? AND piece_id = ? AND user_id = ?').get(chunkId, pieceId, userId) !== undefined
}

/**
 * Stores a piece's chunks, once. Chunk boundaries are fixed in Phase 1 —
 * every path section and attempt hangs off them — so a second call (two
 * tabs opening a fresh piece at once, a retried request) returns the chunks
 * already there instead of replacing them. Also records the piece's
 * measure count and new-measure count, which come from the same parse.
 * Caller must have verified the piece is owned by `userId`.
 */
export function createChunks(
  db: DatabaseSync,
  userId: string,
  pieceId: string,
  input: { chunks: ChunkPlan[]; measureCount: number; newMeasureCount: number; markedTempoBpm?: number },
): Chunk[] {
  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = listChunksForPiece(db, userId, pieceId)
    if (existing.length > 0) {
      db.exec('COMMIT')
      return existing
    }
    const now = Date.now()
    const ids = input.chunks.map(() => generateId())
    const insert = db.prepare(
      `INSERT INTO chunks (id, user_id, piece_id, idx, start_measure, end_measure, repeat_of_chunk_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    input.chunks.forEach((chunk, i) => {
      const repeatOf = chunk.repeatOfIdx !== undefined ? ids[chunk.repeatOfIdx] : undefined
      insert.run(ids[i], userId, pieceId, chunk.idx, chunk.startMeasure, chunk.endMeasure, toParam(repeatOf), now)
    })
    // The score's marked tempo fills in an unset target here, so screens
    // that never load the score (the plan, on a phone) know what the piece
    // is worked up to — it's the same value the client would fall back to.
    db.prepare(
      `UPDATE pieces SET measure_count = ?, new_measure_count = ?, target_tempo_bpm = COALESCE(target_tempo_bpm, ?)
       WHERE id = ? AND user_id = ?`,
    ).run(input.measureCount, input.newMeasureCount, toParam(input.markedTempoBpm), pieceId, userId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return listChunksForPiece(db, userId, pieceId)
}

export function listPathSections(db: DatabaseSync, userId: string): Section[] {
  const rows = db.prepare('SELECT * FROM sections WHERE user_id = ? AND chunk_id IS NOT NULL').all(userId) as unknown as SectionRow[]
  return rows.map(sectionFromRow)
}

/** Every attempt on a path section, without `noteResults` — the rules that read the whole library (start tempo, the plan) only need the aggregate. */
export function listPathAttempts(db: DatabaseSync, userId: string): PathAttempt[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.section_id, a.piece_id, a.tempo_bpm, a.timestamp, a.aborted, a.duration_ms, a.aggregate, a.session_id
       FROM attempts a JOIN sections s ON s.id = a.section_id
       WHERE a.user_id = ? AND s.chunk_id IS NOT NULL
       ORDER BY a.timestamp`,
    )
    .all(userId) as unknown as Omit<AttemptRow, 'note_results'>[]
  return rows.map((row) => ({
    id: row.id,
    sectionId: row.section_id,
    pieceId: row.piece_id,
    tempoBpm: row.tempo_bpm,
    timestamp: row.timestamp,
    aborted: fromIntBoolean(row.aborted),
    durationMs: nullToUndefined(row.duration_ms),
    aggregate: JSON.parse(row.aggregate) as Attempt['aggregate'],
    sessionId: nullToUndefined(row.session_id),
  }))
}

export type CollectionKind = 'book' | 'exam' | 'other'
export const COLLECTION_KINDS: readonly CollectionKind[] = ['book', 'exam', 'other']

export interface Collection {
  id: string
  name: string
  kind: CollectionKind
  examDate?: number
  createdAt: number
  /** In collection order: by page for a book, then by position. */
  pieces: { pieceId: string; position: number; page?: number }[]
}

export function listCollections(db: DatabaseSync, userId: string): Collection[] {
  const rows = db.prepare('SELECT * FROM collections WHERE user_id = ? ORDER BY created_at').all(userId) as unknown as {
    id: string
    name: string
    kind: string
    exam_date: number | null
    created_at: number
  }[]
  const members = db
    .prepare('SELECT collection_id, piece_id, position, page FROM collection_pieces WHERE user_id = ? ORDER BY page IS NULL, page, position')
    .all(userId) as unknown as { collection_id: string; piece_id: string; position: number; page: number | null }[]
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as CollectionKind,
    examDate: nullToUndefined(row.exam_date),
    createdAt: row.created_at,
    pieces: members
      .filter((m) => m.collection_id === row.id)
      .map((m) => ({ pieceId: m.piece_id, position: m.position, page: nullToUndefined(m.page) })),
  }))
}

export function getCollection(db: DatabaseSync, userId: string, id: string): Collection | undefined {
  return listCollections(db, userId).find((c) => c.id === id)
}

export function createCollection(db: DatabaseSync, userId: string, input: { name: string; kind: CollectionKind; examDate?: number }): Collection {
  const id = generateId()
  db.prepare('INSERT INTO collections (id, user_id, name, kind, exam_date, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    userId,
    input.name,
    input.kind,
    toParam(input.examDate),
    Date.now(),
  )
  return getCollection(db, userId, id)!
}

/** `examDate: null` clears it; omitted fields are left as they are. */
export function updateCollection(
  db: DatabaseSync,
  userId: string,
  id: string,
  updates: { name?: string; examDate?: number | null },
): Collection | undefined {
  if (updates.name !== undefined) db.prepare('UPDATE collections SET name = ? WHERE id = ? AND user_id = ?').run(updates.name, id, userId)
  if (updates.examDate !== undefined) {
    db.prepare('UPDATE collections SET exam_date = ? WHERE id = ? AND user_id = ?').run(updates.examDate, id, userId)
  }
  return getCollection(db, userId, id)
}

export function deleteCollection(db: DatabaseSync, userId: string, id: string): boolean {
  return db.prepare('DELETE FROM collections WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
}

export function ownsCollection(db: DatabaseSync, userId: string, id: string): boolean {
  return db.prepare('SELECT 1 FROM collections WHERE id = ? AND user_id = ?').get(id, userId) !== undefined
}

/** Adds (or re-pages) a piece in a collection, at the end unless a position is given. Caller must have verified both are owned by `userId`. */
export function addPieceToCollection(
  db: DatabaseSync,
  userId: string,
  collectionId: string,
  pieceId: string,
  options: { page?: number } = {},
): void {
  const { next } = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM collection_pieces WHERE collection_id = ? AND user_id = ?')
    .get(collectionId, userId) as { next: number }
  db.prepare(
    `INSERT INTO collection_pieces (collection_id, piece_id, user_id, position, page) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(collection_id, piece_id) DO UPDATE SET page = excluded.page`,
  ).run(collectionId, pieceId, userId, next, toParam(options.page))
}

export function removePieceFromCollection(db: DatabaseSync, userId: string, collectionId: string, pieceId: string): boolean {
  return (
    db.prepare('DELETE FROM collection_pieces WHERE collection_id = ? AND piece_id = ? AND user_id = ?').run(collectionId, pieceId, userId)
      .changes > 0
  )
}

export interface LessonPiece {
  pieceId: string
  outcome: LessonOutcome
  focus?: string
}

export const LESSON_OUTCOMES: readonly LessonOutcome[] = ['finished', 'continue', 'new']

export interface Lesson {
  sessionId: string
  startedAt: number
  endedAt: number
  note?: string
  pieces: LessonPiece[]
}

/**
 * Logs a lesson: a manual practice session labelled "Lesson" (so it shows
 * in Sessions and keeps the streak honest, like any logged practice) plus
 * a row per piece covered. Finished sets the piece's `finished_at` — the
 * teacher's verdict, whatever the path says — and Keep going or New clears
 * it again. One transaction, so a lesson is never half-recorded. Caller
 * must have verified every piece id is owned by `userId`.
 */
export function createLesson(
  db: DatabaseSync,
  userId: string,
  input: { startedAt: number; endedAt: number; note?: string; pieces: LessonPiece[] },
): Lesson {
  db.exec('BEGIN IMMEDIATE')
  let sessionId: string
  try {
    sessionId = createManualSession(db, userId, { startedAt: input.startedAt, endedAt: input.endedAt, label: 'Lesson', note: input.note }).id
    const insert = db.prepare('INSERT INTO lesson_pieces (session_id, piece_id, user_id, outcome, focus) VALUES (?, ?, ?, ?, ?)')
    const setFinished = db.prepare('UPDATE pieces SET finished_at = ? WHERE id = ? AND user_id = ?')
    for (const piece of input.pieces) {
      insert.run(sessionId, piece.pieceId, userId, piece.outcome, toParam(piece.focus))
      setFinished.run(piece.outcome === 'finished' ? input.startedAt : null, piece.pieceId, userId)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
  return listLessons(db, userId).find((l) => l.sessionId === sessionId)!
}

/** Lessons logged with per-piece outcomes, newest first. (Older manual sessions labelled "Lesson" still show in Sessions; they just have no outcomes to plan from.) */
export function listLessons(db: DatabaseSync, userId: string): Lesson[] {
  const rows = db
    .prepare(
      `SELECT ps.id, ps.started_at, ps.ended_at, ps.note, lp.piece_id, lp.outcome, lp.focus
       FROM lesson_pieces lp JOIN practice_sessions ps ON ps.id = lp.session_id
       WHERE lp.user_id = ? AND ps.user_id = ?
       ORDER BY ps.started_at DESC, lp.rowid`,
    )
    .all(userId, userId) as unknown as {
    id: string
    started_at: number
    ended_at: number
    note: string | null
    piece_id: string
    outcome: string
    focus: string | null
  }[]
  const lessons = new Map<string, Lesson>()
  for (const row of rows) {
    let lesson = lessons.get(row.id)
    if (!lesson) {
      lesson = { sessionId: row.id, startedAt: row.started_at, endedAt: row.ended_at, note: nullToUndefined(row.note), pieces: [] }
      lessons.set(row.id, lesson)
    }
    lesson.pieces.push({ pieceId: row.piece_id, outcome: row.outcome as LessonOutcome, focus: nullToUndefined(row.focus) })
  }
  return [...lessons.values()]
}

export interface UserSettings {
  /** 0 = Sunday … 6 = Saturday. */
  lessonWeekday?: number
}

export function getSettings(db: DatabaseSync, userId: string): UserSettings {
  const row = db.prepare('SELECT lesson_weekday FROM users WHERE id = ?').get(userId) as { lesson_weekday: number | null } | undefined
  return { lessonWeekday: nullToUndefined(row?.lesson_weekday ?? null) }
}

export function updateSettings(db: DatabaseSync, userId: string, updates: { lessonWeekday?: number | null }): UserSettings {
  if (updates.lessonWeekday !== undefined) {
    db.prepare('UPDATE users SET lesson_weekday = ? WHERE id = ?').run(updates.lessonWeekday, userId)
  }
  return getSettings(db, userId)
}

/** The most recent session note — "One line for next time" from the session-end screen, shown at the top of the next plan. */
export function latestSessionNote(db: DatabaseSync, userId: string): { sessionId: string; note: string; startedAt: number } | undefined {
  const row = db
    .prepare(
      `SELECT id, note, started_at FROM practice_sessions
       WHERE user_id = ? AND source = 'derived' AND note IS NOT NULL AND note != ''
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(userId) as { id: string; note: string; started_at: number } | undefined
  return row ? { sessionId: row.id, note: row.note, startedAt: row.started_at } : undefined
}

export function isPathRung(value: unknown): value is PathRung {
  return typeof value === 'string' && (PATH_RUNGS as readonly string[]).includes(value)
}

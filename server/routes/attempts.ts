import type { DatabaseSync } from 'node:sqlite'
import express, { type Router } from 'express'
import { getUserId } from '../auth/session.ts'
import type { Attempt } from '../../src/lib/db/db.ts'
import * as queries from '../queries.ts'

export function createAttemptsRouter(db: DatabaseSync): Router {
  const router = express.Router()

  // Unlike pieces/sections, the client generates the full Attempt (id and
  // timestamp included) before this call ever happens — see
  // `recordAttempt` in `src/lib/db/attemptsRepo.ts`. It writes to a local
  // outbox first and retries the POST blindly on failure, so this route
  // upserts by id (queries.recordAttempt uses ON CONFLICT DO NOTHING) —
  // a duplicate delivery of an already-stored attempt must be a harmless
  // no-op, not a second row or a 409.
  router.post('/api/attempts', (req, res) => {
    const userId = getUserId(req)
    const attempt = req.body as Partial<Attempt>
    if (
      !attempt?.id ||
      !attempt.sectionId ||
      !attempt.pieceId ||
      typeof attempt.tempoBpm !== 'number' ||
      typeof attempt.timestamp !== 'number' ||
      typeof attempt.aborted !== 'boolean' ||
      !attempt.aggregate ||
      !attempt.noteResults
    ) {
      res.status(400).json({ error: 'id, sectionId, pieceId, tempoBpm, timestamp, aborted, aggregate, and noteResults are required' })
      return
    }
    // The one place a cross-user write could otherwise sneak in: without
    // this, any logged-in user could POST an attempt naming any pieceId and
    // have it attributed there. Not the piece owner → the piece doesn't
    // exist as far as this request is concerned.
    if (!queries.ownsPiece(db, userId, attempt.pieceId)) {
      res.status(404).json({ error: 'Piece not found' })
      return
    }
    queries.recordAttempt(db, userId, attempt as Attempt)
    res.status(204).end()
  })

  router.delete('/api/attempts/:id', (req, res) => {
    if (!queries.deleteAttempt(db, getUserId(req), req.params.id)) {
      res.status(404).json({ error: 'Attempt not found' })
      return
    }
    res.status(204).end()
  })

  // Trimmed {pieceId, timestamp, durationMs} rows for the whole library —
  // what the piece-library view's recency sort and total-practice-time
  // figures need (see buildPieceStatsMap), without every attempt's full
  // noteResults over the wire. See the plan's "two projections" note.
  router.get('/api/attempts/summary', (req, res) => {
    res.json(queries.listAttemptSummaries(db, getUserId(req)))
  })

  return router
}

import type { DatabaseSync } from 'node:sqlite'
import express, { type Router } from 'express'
import { getUserId } from '../auth/session.ts'
import * as queries from '../queries.ts'

/**
 * REST surface for `practice_sessions` — see schema.sql's doc comment
 * there and docs/sessions-plan.md. Derived sessions are read-only except
 * for their `note`/`label`/`pieceId`: their `startedAt`/`endedAt` are
 * owned by `assignAttemptToSession` (queries.ts), which is why this router
 * — not just the client — rejects a time edit on one rather than silently
 * accepting a value the next recorded attempt would just overwrite.
 */
export function createSessionsRouter(db: DatabaseSync): Router {
  const router = express.Router()

  router.get('/api/sessions', (req, res) => {
    const since = req.query.since !== undefined ? Number(req.query.since) : undefined
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined
    if (since !== undefined && !Number.isFinite(since)) {
      res.status(400).json({ error: 'since must be a numeric epoch-ms timestamp' })
      return
    }
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      res.status(400).json({ error: 'limit must be a positive integer' })
      return
    }
    res.json(queries.listSessions(db, getUserId(req), { since, limit }))
  })

  // Practice Woodshed didn't witness — see queries.ts's createManualSession
  // doc comment. `pieceId`, if given, must be owned by this user; naming
  // someone else's (or a nonexistent) piece id is the one way this route
  // could otherwise leak or corrupt cross-user data.
  router.post('/api/sessions', (req, res) => {
    const userId = getUserId(req)
    const body = req.body as
      | { startedAt?: unknown; endedAt?: unknown; label?: unknown; pieceId?: unknown; note?: unknown }
      | undefined
    const startedAt = body?.startedAt
    const endedAt = body?.endedAt
    if (typeof startedAt !== 'number' || typeof endedAt !== 'number' || !Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
      res.status(400).json({ error: 'startedAt and endedAt (epoch ms) are required' })
      return
    }
    if (endedAt < startedAt) {
      res.status(400).json({ error: 'endedAt must not be before startedAt' })
      return
    }
    const label = typeof body?.label === 'string' ? body.label.trim() || undefined : undefined
    const note = typeof body?.note === 'string' ? body.note.trim() || undefined : undefined
    const pieceId = typeof body?.pieceId === 'string' ? body.pieceId : undefined
    if (pieceId !== undefined && !queries.ownsPiece(db, userId, pieceId)) {
      res.status(404).json({ error: 'Piece not found' })
      return
    }
    const session = queries.createManualSession(db, userId, { startedAt, endedAt, label, pieceId, note })
    res.status(201).json(session)
  })

  // note/label/pieceId are editable on any session; startedAt/endedAt only
  // on a manual one (see this router's own doc comment).
  router.patch('/api/sessions/:id', (req, res) => {
    const userId = getUserId(req)
    const existing = queries.getSession(db, userId, req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    const body = req.body as
      | { note?: unknown; label?: unknown; pieceId?: unknown; startedAt?: unknown; endedAt?: unknown }
      | undefined
    if (
      existing.source === 'derived' &&
      (Object.hasOwn(body ?? {}, 'startedAt') || Object.hasOwn(body ?? {}, 'endedAt'))
    ) {
      res
        .status(400)
        .json({ error: "A derived session's start/end time follows the attempts in it and can't be edited directly." })
      return
    }
    const pieceId = body && Object.hasOwn(body, 'pieceId') ? (body.pieceId === null ? null : String(body.pieceId)) : undefined
    if (typeof pieceId === 'string' && !queries.ownsPiece(db, userId, pieceId)) {
      res.status(404).json({ error: 'Piece not found' })
      return
    }
    const updates: Parameters<typeof queries.updateSession>[3] = {}
    if (body && Object.hasOwn(body, 'note')) updates.note = body.note === null ? null : String(body.note).trim() || null
    if (body && Object.hasOwn(body, 'label')) updates.label = body.label === null ? null : String(body.label).trim() || null
    if (pieceId !== undefined) updates.pieceId = pieceId
    if (typeof body?.startedAt === 'number') updates.startedAt = body.startedAt
    if (typeof body?.endedAt === 'number') updates.endedAt = body.endedAt

    const updated = queries.updateSession(db, userId, req.params.id, updates)
    res.json(updated)
  })

  router.delete('/api/sessions/:id', (req, res) => {
    const userId = getUserId(req)
    const existing = queries.getSession(db, userId, req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    if (existing.source !== 'manual') {
      res.status(400).json({ error: 'Only manual sessions can be deleted — clear its note instead.' })
      return
    }
    queries.deleteSession(db, userId, req.params.id)
    res.status(204).end()
  })

  return router
}

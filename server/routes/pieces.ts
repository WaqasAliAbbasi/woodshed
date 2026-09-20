import type { DatabaseSync } from 'node:sqlite'
import express, { type Router } from 'express'
import { getUserId } from '../auth/session.ts'
import { generateId } from '../../src/lib/id.ts'
import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from '../../src/lib/musicxml/buildExpectedTimeline.ts'
import type { Piece } from '../../src/lib/db/db.ts'
import * as queries from '../queries.ts'

/**
 * `GET /api/pieces` returns summaries (no `musicXml`) — the old client-side
 * `listPieces()` returned full rows, fine for a same-process IndexedDB read
 * but not for a library-list response over the network (every piece's score
 * XML, all at once). `GET /api/pieces/:id` — a *single* piece — still
 * returns the full `Piece` including `musicXml`, since that's exactly what
 * opening a piece needs. See the plan's "two projections" note.
 *
 * Every route here is scoped to `getUserId(req)` — a piece id that exists
 * but belongs to someone else 404s exactly like one that doesn't exist at
 * all, so this never confirms another user's piece ids even indirectly.
 */
export function createPiecesRouter(db: DatabaseSync): Router {
  const router = express.Router()

  router.get('/api/pieces', (req, res) => {
    res.json(queries.listPieceSummaries(db, getUserId(req)))
  })

  router.get('/api/pieces/:id', (req, res) => {
    const piece = queries.getPiece(db, getUserId(req), req.params.id)
    if (!piece) {
      res.status(404).json({ error: 'Piece not found' })
      return
    }
    res.json(piece)
  })

  router.post('/api/pieces', (req, res) => {
    const body = req.body as Partial<Omit<Piece, 'id' | 'createdAt' | 'updatedAt'>>
    if (!body?.title || !body.filename || typeof body.musicXml !== 'string') {
      res.status(400).json({ error: 'title, filename, and musicXml are required' })
      return
    }
    const now = Date.now()
    const piece: Piece = {
      id: generateId(),
      title: body.title,
      composer: body.composer,
      filename: body.filename,
      musicXml: body.musicXml,
      createdAt: now,
      updatedAt: now,
      measureCount: body.measureCount ?? 0,
    }
    queries.createPiece(db, getUserId(req), piece)
    res.status(201).json(piece)
  })

  // Title + composer — the only writes PieceLibrary's UI currently makes to
  // an existing piece. The response is a summary (no musicXml): the caller
  // (RenamableTitle/RenamableComposer, see App.tsx) merges the changed
  // fields into the piece it already holds rather than replacing the whole
  // object, so the score already loaded in memory is never discarded on an
  // edit. `composer: ""` clears it (stored as SQL NULL); omitting the field
  // entirely leaves it unchanged.
  router.patch('/api/pieces/:id', (req, res) => {
    const body = req.body as { title?: string; composer?: string } | undefined
    const title = body?.title?.trim()
    if (!title) {
      res.status(400).json({ error: 'title is required' })
      return
    }
    const composer = body?.composer === undefined ? undefined : body.composer.trim() || null
    const updated = queries.updatePiece(db, getUserId(req), req.params.id, { title, composer })
    if (!updated) {
      res.status(404).json({ error: 'Piece not found' })
      return
    }
    res.json(updated)
  })

  // The tempo the student is working this piece up to — what the score's
  // per-measure progress shading judges "ready" against. Its own route
  // rather than a field on the PATCH above, which is the rename path and
  // insists on a title a tempo change has no reason to send.
  router.patch('/api/pieces/:id/target-tempo', (req, res) => {
    const targetTempoBpm = (req.body as { targetTempoBpm?: unknown } | undefined)?.targetTempoBpm
    if (
      typeof targetTempoBpm !== 'number' ||
      !Number.isInteger(targetTempoBpm) ||
      targetTempoBpm < MIN_TEMPO_BPM ||
      targetTempoBpm > MAX_TEMPO_BPM
    ) {
      res.status(400).json({ error: `targetTempoBpm must be an integer between ${MIN_TEMPO_BPM} and ${MAX_TEMPO_BPM}` })
      return
    }
    const updated = queries.updatePieceTargetTempo(db, getUserId(req), req.params.id, targetTempoBpm)
    if (!updated) {
      res.status(404).json({ error: 'Piece not found' })
      return
    }
    res.json(updated)
  })

  router.delete('/api/pieces/:id', (req, res) => {
    if (!queries.deletePiece(db, getUserId(req), req.params.id)) {
      res.status(404).json({ error: 'Piece not found' })
      return
    }
    res.status(204).end()
  })

  router.get('/api/pieces/:id/sections', (req, res) => {
    res.json(queries.listSectionsForPiece(db, getUserId(req), req.params.id))
  })

  router.get('/api/pieces/:id/attempts', (req, res) => {
    res.json(queries.listAttemptsForPiece(db, getUserId(req), req.params.id))
  })

  return router
}

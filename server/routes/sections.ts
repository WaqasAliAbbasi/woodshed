import type { DatabaseSync } from 'node:sqlite'
import express, { type Router } from 'express'
import { getUserId } from '../auth/session.ts'
import { generateId } from '../../src/lib/id.ts'
import type { Section } from '../../src/lib/db/db.ts'
import * as queries from '../queries.ts'

export function createSectionsRouter(db: DatabaseSync): Router {
  const router = express.Router()

  router.post('/api/sections', (req, res) => {
    const userId = getUserId(req)
    const body = req.body as Partial<Omit<Section, 'id' | 'createdAt'>>
    if (!body?.pieceId || !body.label || body.startMeasure === undefined || body.endMeasure === undefined) {
      res.status(400).json({ error: 'pieceId, label, startMeasure, and endMeasure are required' })
      return
    }
    // A section always belongs to a piece — reject up front rather than
    // create an orphaned-in-spirit section (the FK would still catch a
    // *nonexistent* piece id, but not one that exists and belongs to
    // someone else).
    if (!queries.ownsPiece(db, userId, body.pieceId)) {
      res.status(404).json({ error: 'Piece not found' })
      return
    }
    const section: Section = {
      id: generateId(),
      pieceId: body.pieceId,
      label: body.label,
      startMeasure: body.startMeasure,
      endMeasure: body.endMeasure,
      defaultTempoBpm: body.defaultTempoBpm ?? 80,
      createdAt: Date.now(),
      handFilter: body.handFilter,
      mode: body.mode,
    }
    queries.createSection(db, userId, section)
    res.status(201).json(section)
  })

  router.get('/api/sections/:id', (req, res) => {
    const section = queries.getSection(db, getUserId(req), req.params.id)
    if (!section) {
      res.status(404).json({ error: 'Section not found' })
      return
    }
    res.json(section)
  })

  router.delete('/api/sections/:id', (req, res) => {
    if (!queries.deleteSection(db, getUserId(req), req.params.id)) {
      res.status(404).json({ error: 'Section not found' })
      return
    }
    res.status(204).end()
  })

  router.get('/api/sections/:id/attempts', (req, res) => {
    res.json(queries.listAttemptsForSection(db, getUserId(req), req.params.id))
  })

  return router
}

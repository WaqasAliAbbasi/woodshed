import type { DatabaseSync } from 'node:sqlite'
import express, { type Router } from 'express'
import { getUserId } from '../auth/session.ts'
import * as queries from '../queries.ts'

/** Books (ordered by page) and exam sets. Scoped like every other router: a collection or piece id that isn't this user's 404s. */
export function createCollectionsRouter(db: DatabaseSync): Router {
  const router = express.Router()

  router.get('/api/collections', (req, res) => {
    res.json(queries.listCollections(db, getUserId(req)))
  })

  router.post('/api/collections', (req, res) => {
    const body = req.body as { name?: unknown; kind?: unknown; examDate?: unknown } | undefined
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name || !queries.COLLECTION_KINDS.includes(body?.kind as queries.CollectionKind)) {
      res.status(400).json({ error: "name and kind ('book', 'exam' or 'other') are required" })
      return
    }
    const examDate = typeof body?.examDate === 'number' ? body.examDate : undefined
    res.status(201).json(queries.createCollection(db, getUserId(req), { name, kind: body!.kind as queries.CollectionKind, examDate }))
  })

  router.patch('/api/collections/:id', (req, res) => {
    const body = req.body as { name?: unknown; examDate?: unknown } | undefined
    const name = typeof body?.name === 'string' ? body.name.trim() || undefined : undefined
    const examDate = body && Object.hasOwn(body, 'examDate') ? (typeof body.examDate === 'number' ? body.examDate : null) : undefined
    const updated = queries.updateCollection(db, getUserId(req), req.params.id, { name, examDate })
    if (!updated) {
      res.status(404).json({ error: 'Collection not found' })
      return
    }
    res.json(updated)
  })

  router.delete('/api/collections/:id', (req, res) => {
    if (!queries.deleteCollection(db, getUserId(req), req.params.id)) {
      res.status(404).json({ error: 'Collection not found' })
      return
    }
    res.status(204).end()
  })

  router.put('/api/collections/:id/pieces/:pieceId', (req, res) => {
    const userId = getUserId(req)
    if (!queries.ownsCollection(db, userId, req.params.id) || !queries.ownsPiece(db, userId, req.params.pieceId)) {
      res.status(404).json({ error: 'Collection or piece not found' })
      return
    }
    const page = (req.body as { page?: unknown } | undefined)?.page
    queries.addPieceToCollection(db, userId, req.params.id, req.params.pieceId, {
      page: typeof page === 'number' && Number.isInteger(page) ? page : undefined,
    })
    res.json(queries.getCollection(db, userId, req.params.id))
  })

  router.delete('/api/collections/:id/pieces/:pieceId', (req, res) => {
    if (!queries.removePieceFromCollection(db, getUserId(req), req.params.id, req.params.pieceId)) {
      res.status(404).json({ error: 'Not in this collection' })
      return
    }
    res.status(204).end()
  })

  return router
}

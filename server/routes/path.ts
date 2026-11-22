import type { DatabaseSync } from 'node:sqlite'
import express, { type Router } from 'express'
import { getUserId } from '../auth/session.ts'
import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from '../../src/lib/musicxml/buildExpectedTimeline.ts'
import type { ChunkPlan } from '../../src/lib/path/chunkPiece.ts'
import * as queries from '../queries.ts'

const MAX_CHUNKS = 200
const MAX_FOCUS_LENGTH = 500

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

/** Shape-checks a client-computed chunk list: contiguous, in order, every chunk 1+ bars, repeats pointing backwards. The boundaries themselves are the client's call (only it parses MusicXML). */
function validChunks(value: unknown): value is ChunkPlan[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHUNKS) return false
  return value.every((c: Partial<ChunkPlan>, i) => {
    if (!c || c.idx !== i || !isInt(c.startMeasure) || !isInt(c.endMeasure) || c.endMeasure < c.startMeasure) return false
    if (i > 0 && c.startMeasure !== (value[i - 1] as ChunkPlan).endMeasure + 1) return false
    return c.repeatOfIdx === undefined || (isInt(c.repeatOfIdx) && c.repeatOfIdx >= 0 && c.repeatOfIdx < i)
  })
}

/**
 * The learning path's REST surface (docs/learning-path.md): chunks, lessons,
 * the lesson-day setting, and one read-everything overview the plan and
 * library screens build from. Every route is scoped by `getUserId(req)`,
 * and every id in a body is checked against that user before it's used.
 */
export function createPathRouter(db: DatabaseSync): Router {
  const router = express.Router()

  router.get('/api/pieces/:id/chunks', (req, res) => {
    res.json(queries.listChunksForPiece(db, getUserId(req), req.params.id))
  })

  // Chunks are computed client-side (see src/lib/path/chunkPiece.ts) and
  // stored once — a second POST returns what's already there.
  router.post('/api/pieces/:id/chunks', (req, res) => {
    const userId = getUserId(req)
    if (!queries.ownsPiece(db, userId, req.params.id)) {
      res.status(404).json({ error: 'Piece not found' })
      return
    }
    const body = req.body as { chunks?: unknown; measureCount?: unknown; newMeasureCount?: unknown; markedTempoBpm?: unknown } | undefined
    if (!validChunks(body?.chunks) || !isInt(body?.measureCount) || !isInt(body?.newMeasureCount)) {
      res.status(400).json({ error: 'chunks (contiguous, in order), measureCount and newMeasureCount are required' })
      return
    }
    const chunks = queries.createChunks(db, userId, req.params.id, {
      chunks: body.chunks,
      measureCount: body.measureCount,
      newMeasureCount: body.newMeasureCount,
      markedTempoBpm:
        isInt(body.markedTempoBpm) && body.markedTempoBpm >= MIN_TEMPO_BPM && body.markedTempoBpm <= MAX_TEMPO_BPM
          ? body.markedTempoBpm
          : undefined,
    })
    res.status(201).json(chunks)
  })

  router.get('/api/path/overview', (req, res) => {
    const userId = getUserId(req)
    res.json({
      pieces: queries.listPieceSummaries(db, userId),
      chunks: queries.listChunks(db, userId),
      sections: queries.listPathSections(db, userId),
      attempts: queries.listPathAttempts(db, userId),
      lessons: queries.listLessons(db, userId),
      collections: queries.listCollections(db, userId),
      settings: queries.getSettings(db, userId),
      lastNote: queries.latestSessionNote(db, userId) ?? null,
    })
  })

  router.post('/api/lessons', (req, res) => {
    const userId = getUserId(req)
    const body = req.body as { startedAt?: unknown; endedAt?: unknown; note?: unknown; pieces?: unknown } | undefined
    const { startedAt, endedAt } = body ?? {}
    if (typeof startedAt !== 'number' || typeof endedAt !== 'number' || !Number.isFinite(startedAt) || endedAt < startedAt) {
      res.status(400).json({ error: 'startedAt and endedAt (epoch ms, end not before start) are required' })
      return
    }
    if (!Array.isArray(body?.pieces) || body.pieces.length === 0) {
      res.status(400).json({ error: 'A lesson needs at least one piece' })
      return
    }
    const pieces: queries.LessonPiece[] = []
    const seen = new Set<string>()
    for (const raw of body.pieces as { pieceId?: unknown; outcome?: unknown; focus?: unknown }[]) {
      const pieceId = typeof raw?.pieceId === 'string' ? raw.pieceId : undefined
      if (!pieceId || !queries.ownsPiece(db, userId, pieceId)) {
        res.status(404).json({ error: 'Piece not found' })
        return
      }
      if (!queries.LESSON_OUTCOMES.includes(raw.outcome as queries.LessonPiece['outcome'])) {
        res.status(400).json({ error: "outcome must be 'finished', 'continue' or 'new'" })
        return
      }
      if (seen.has(pieceId)) continue
      seen.add(pieceId)
      const focus = typeof raw.focus === 'string' ? raw.focus.trim().slice(0, MAX_FOCUS_LENGTH) || undefined : undefined
      pieces.push({ pieceId, outcome: raw.outcome as queries.LessonPiece['outcome'], focus: raw.outcome === 'continue' ? focus : undefined })
    }
    const note = typeof body.note === 'string' ? body.note.trim() || undefined : undefined
    res.status(201).json(queries.createLesson(db, userId, { startedAt, endedAt, note, pieces }))
  })

  router.patch('/api/settings', (req, res) => {
    const userId = getUserId(req)
    const body = req.body as { lessonWeekday?: unknown } | undefined
    const weekday = body?.lessonWeekday
    if (weekday !== undefined && weekday !== null && !(isInt(weekday) && weekday >= 0 && weekday <= 6)) {
      res.status(400).json({ error: 'lessonWeekday must be 0 (Sunday) to 6 (Saturday), or null' })
      return
    }
    res.json(queries.updateSettings(db, userId, { lessonWeekday: weekday as number | null | undefined }))
  })

  return router
}

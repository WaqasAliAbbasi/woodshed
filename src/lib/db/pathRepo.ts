import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../api/client'
import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from '../musicxml/buildExpectedTimeline'
import { chunkPiece, countNewMeasures } from '../path/chunkPiece'
import { parseScore } from '../path/scoreMeasures'
import type { StepSettings } from '../path/stepSettings'
import type { Chunk, LessonOutcome, PathAttempt } from '../path/types'
import type { Piece, Section } from './db'
import type { PieceSummary } from './piecesRepo'
import { createSection, listSectionsForPiece } from './sectionsRepo'

export type CollectionKind = 'book' | 'exam' | 'other'

export interface Collection {
  id: string
  name: string
  kind: CollectionKind
  examDate?: number
  createdAt: number
  /** In collection order: by page, then position. */
  pieces: { pieceId: string; position: number; page?: number }[]
}

export interface LessonPiece {
  pieceId: string
  outcome: LessonOutcome
  focus?: string
}

export interface Lesson {
  sessionId: string
  startedAt: number
  endedAt: number
  note?: string
  pieces: LessonPiece[]
}

export interface UserSettings {
  /** 0 = Sunday … 6 = Saturday. */
  lessonWeekday?: number
}

/** Everything the plan, library and piece screens build from, in one read — see server/routes/path.ts. */
export interface PathOverview {
  pieces: PieceSummary[]
  chunks: Chunk[]
  /** Path sections only (those with a chunk). */
  sections: Section[]
  /** Attempts on path sections, without note results. */
  attempts: PathAttempt[]
  /** Newest first. */
  lessons: Lesson[]
  collections: Collection[]
  settings: UserSettings
  lastNote: { sessionId: string; note: string; startedAt: number } | null
}

export function getPathOverview(signal?: AbortSignal): Promise<PathOverview> {
  return apiGet<PathOverview>('/api/path/overview', signal)
}

export function listChunksForPiece(pieceId: string): Promise<Chunk[]> {
  return apiGet<Chunk[]>(`/api/pieces/${pieceId}/chunks`)
}

/**
 * A piece's chunks, cutting and storing them first if this is the first
 * time it's been opened on the path. Chunking runs here, not on the server,
 * because only the client parses MusicXML; the server keeps the first set
 * it's sent, so two devices opening a fresh piece at once still agree.
 */
export async function ensureChunks(piece: Pick<Piece, 'id' | 'musicXml'>): Promise<Chunk[]> {
  const existing = await listChunksForPiece(piece.id)
  if (existing.length > 0) return existing
  const { measures, markedTempoBpm } = parseScore(piece.musicXml)
  const chunks = chunkPiece(measures)
  if (chunks.length === 0) return []
  return apiPost<Chunk[]>(`/api/pieces/${piece.id}/chunks`, {
    chunks,
    measureCount: measures.length,
    newMeasureCount: countNewMeasures(measures),
    markedTempoBpm: markedTempoBpm === undefined ? undefined : Math.min(MAX_TEMPO_BPM, Math.max(MIN_TEMPO_BPM, markedTempoBpm)),
  })
}

/**
 * The section a path step is stored under — found by chunk, rung, range,
 * hand and mode, or created. The path's counterpart to `resolveSection`
 * (which, in turn, never picks one of these up for Free practice).
 */
export async function resolvePathSection(pieceId: string, step: StepSettings): Promise<Section> {
  const sections = await listSectionsForPiece(pieceId)
  const existing = sections.find(
    (s) =>
      s.chunkId === step.chunkId &&
      s.rung === step.rung &&
      s.startMeasure === step.range.startMeasure &&
      s.endMeasure === step.range.endMeasure &&
      (s.handFilter ?? 'both') === step.handFilter &&
      (s.mode ?? 'metronome') === step.mode,
  )
  if (existing) return existing
  return createSection({
    pieceId,
    label: step.label,
    startMeasure: step.range.startMeasure,
    endMeasure: step.range.endMeasure,
    defaultTempoBpm: step.tempo.bpm,
    handFilter: step.handFilter,
    mode: step.mode,
    chunkId: step.chunkId,
    rung: step.rung,
  })
}

export function createLesson(input: { startedAt: number; endedAt: number; note?: string; pieces: LessonPiece[] }): Promise<Lesson> {
  return apiPost<Lesson>('/api/lessons', input)
}

export function updateSettings(updates: { lessonWeekday?: number | null }): Promise<UserSettings> {
  return apiPatch<UserSettings>('/api/settings', updates)
}

export function createCollection(input: { name: string; kind: CollectionKind; examDate?: number }): Promise<Collection> {
  return apiPost<Collection>('/api/collections', input)
}

export function updateCollection(id: string, updates: { name?: string; examDate?: number | null }): Promise<Collection> {
  return apiPatch<Collection>(`/api/collections/${id}`, updates)
}

export function deleteCollection(id: string): Promise<void> {
  return apiDelete(`/api/collections/${id}`)
}

export function addPieceToCollection(collectionId: string, pieceId: string, page?: number): Promise<Collection> {
  return apiPut<Collection>(`/api/collections/${collectionId}/pieces/${pieceId}`, { page })
}

export function removePieceFromCollection(collectionId: string, pieceId: string): Promise<void> {
  return apiDelete(`/api/collections/${collectionId}/pieces/${pieceId}`)
}

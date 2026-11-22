import { useCallback, useEffect, useMemo, useState } from 'react'
import { listAttemptsForPiece } from '../../lib/db/attemptsRepo'
import type { Attempt, Piece, Section } from '../../lib/db/db'
import { ensureChunks, getPathOverview, type PathOverview } from '../../lib/db/pathRepo'
import { getPiece } from '../../lib/db/piecesRepo'
import { listSectionsForPiece } from '../../lib/db/sectionsRepo'
import { MAX_TEMPO_BPM, MIN_TEMPO_BPM } from '../../lib/musicxml/buildExpectedTimeline'
import { countNewMeasures } from '../../lib/path/chunkPiece'
import { deriveState } from '../../lib/path/deriveState'
import { piecePath, type PiecePath } from '../../lib/path/nextStep'
import { parseScore } from '../../lib/path/scoreMeasures'
import type { Rung3Pass } from '../../lib/path/tempo'
import { targetTempo } from '../../lib/path/tempo'
import type { Chunk } from '../../lib/path/types'

export interface PieceData {
  piece: Piece
  chunks: Chunk[]
  sections: Section[]
  /** Full attempts (with note results) for this piece. */
  attempts: Attempt[]
  overview: PathOverview
  measureCount: number
  newMeasureCount: number
}

/**
 * One piece, ready for the path: the full score, its chunks (cut on first
 * open), its sections and full attempts, and the library-wide overview the
 * start tempo and "Finish now" need. `addAttempt` folds a just-recorded
 * attempt in without a refetch, so the next try's settings are right the
 * moment the result shows.
 */
export function usePiecePath(pieceId: string) {
  const [data, setData] = useState<PieceData | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    const piece = await getPiece(pieceId)
    if (!piece) throw new Error('That piece no longer exists.')
    const chunks = await ensureChunks(piece)
    const [sections, attempts, overview] = await Promise.all([listSectionsForPiece(pieceId), listAttemptsForPiece(pieceId), getPathOverview()])
    const { measures } = parseScore(piece.musicXml)
    const newMeasureCount = countNewMeasures(measures)
    return { piece, chunks, sections, attempts, overview, measureCount: measures.length, newMeasureCount }
  }, [pieceId])

  useEffect(() => {
    let cancelled = false
    load()
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [load])

  const addAttempt = useCallback(async (attempt: Attempt) => {
    setNow(Date.now())
    // The section may be one this visit just created.
    const sections = await listSectionsForPiece(attempt.pieceId)
    setData((d) => (d ? { ...d, sections, attempts: [...d.attempts.filter((a) => a.id !== attempt.id), attempt] } : d))
  }, [])

  const derived = useMemo(() => {
    if (!data) return undefined
    const marked = parseScore(data.piece.musicXml).markedTempoBpm
    const target = targetTempo(
      data.piece.targetTempoBpm,
      marked === undefined ? undefined : Math.min(MAX_TEMPO_BPM, Math.max(MIN_TEMPO_BPM, marked)),
    )
    const path: PiecePath = piecePath({ chunks: data.chunks, sections: data.sections, attempts: data.attempts, targetTempoBpm: target, now })
    // Rung-3 passes everywhere else in the library, plus this piece's own (fresher than the overview).
    const library = deriveState(data.overview, now)
    const rung3Passes: Rung3Pass[] = [
      ...library.rung3Passes.filter((p) => !path.chunks.some((c) => c.progress.rung3.passedAt === p.passedAt)),
      ...path.chunks.flatMap((c) =>
        c.repeatOf === undefined && c.progress.rung3.passTempo !== undefined && c.progress.rung3.passedAt !== undefined
          ? [{ tempoBpm: c.progress.rung3.passTempo, passedAt: c.progress.rung3.passedAt }]
          : [],
      ),
    ]
    return { path, target, rung3Passes, library }
  }, [data, now])

  return { data, derived, error, now, addAttempt }
}

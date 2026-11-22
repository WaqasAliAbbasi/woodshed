import type { PracticeSession } from '../../lib/db/db'
import type { Lesson } from '../../lib/db/pathRepo'

/** A logged lesson — or an old manual session labelled "Lesson", which still reads as one (docs/learning-path.md, "Logging a lesson"). */
export function isLessonSession(s: PracticeSession, lessons: Map<string, Lesson>): boolean {
  return lessons.has(s.id) || (s.source === 'manual' && s.label?.trim().toLowerCase() === 'lesson')
}

/** Which pieces a session touched: a lesson's rows, a derived session's attempts, a manual one's piece. */
export function piecesOf(s: PracticeSession, lessons: Map<string, Lesson>): string[] {
  const lesson = lessons.get(s.id)
  if (lesson) return lesson.pieces.map((p) => p.pieceId)
  if (s.pieceIds.length > 0) return s.pieceIds
  return s.pieceId ? [s.pieceId] : []
}

/** Sessions touching any piece of a collection; all of them when `collectionPieces` is undefined. */
export function filterByPieces(sessions: PracticeSession[], lessons: Map<string, Lesson>, collectionPieces: Set<string> | undefined): PracticeSession[] {
  if (!collectionPieces) return sessions
  return sessions.filter((s) => piecesOf(s, lessons).some((id) => collectionPieces.has(id)))
}

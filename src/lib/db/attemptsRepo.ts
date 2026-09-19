import { apiDelete, apiGet } from '../api/client'
import { generateId } from '../id'
import { getDb, type Attempt } from './db'

/**
 * How long `recordAttempt` waits for the server to acknowledge an attempt
 * before giving up and letting the caller proceed anyway. Short on purpose:
 * this runs right after `AttemptScoring` in the practice state machine (see
 * PracticeSession.tsx), and the whole point of the outbox is that a slow or
 * dropped connection there must not strand the UI. On a healthy connection
 * this resolves in well under a second and the caller never notices the
 * timeout exists; the attempt has already been written to the outbox
 * before this fires either way, so a timeout never loses data — it just
 * means the just-finished attempt won't show up in History/Progress until
 * the background flush gets through.
 */
const OUTBOX_PUSH_TIMEOUT_MS = 4000

async function pushAttempt(attempt: Attempt, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/attempts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(attempt),
    signal,
  })
  if (!res.ok) throw new Error(`POST /api/attempts failed: ${res.status}`)
  const db = await getDb()
  await db.delete('outbox', attempt.id)
}

/**
 * Writes to the local outbox first, then tries to push in the background —
 * see the module doc comment. The server upserts by id (see
 * `server/queries.ts`'s `recordAttempt`), so a retried push of an
 * already-stored attempt is a harmless no-op, not a duplicate.
 */
export async function recordAttempt(input: Omit<Attempt, 'id' | 'timestamp'>): Promise<Attempt> {
  const attempt: Attempt = { ...input, id: generateId(), timestamp: Date.now() }
  const db = await getDb()
  await db.put('outbox', attempt)
  try {
    await pushAttempt(attempt, AbortSignal.timeout(OUTBOX_PUSH_TIMEOUT_MS))
  } catch {
    // Still queued in the outbox — flushOutbox() (called on app startup,
    // and opportunistically before it) retries once the network recovers.
  }
  return attempt
}

/** Retries every attempt still sitting in the outbox — called once on app startup (see App.tsx) to sweep up anything a previous session couldn't deliver (offline, a closed tab mid-push, a server blip). Failures stay queued silently; there's no user-facing error for a background sync retry. */
export async function flushOutbox(): Promise<void> {
  const db = await getDb()
  const pending = await db.getAll('outbox')
  await Promise.allSettled(pending.map((attempt) => pushAttempt(attempt)))
}

export async function listAttemptsForSection(sectionId: string): Promise<Attempt[]> {
  return apiGet<Attempt[]>(`/api/sections/${sectionId}/attempts`)
}

export async function listAttemptsForPiece(pieceId: string): Promise<Attempt[]> {
  return apiGet<Attempt[]>(`/api/pieces/${pieceId}/attempts`)
}

/** Trimmed {pieceId, timestamp, durationMs} rows for the whole library — see `buildPieceStatsMap`, the only caller, and the server route's own doc comment on why this isn't full `Attempt[]`. */
export async function listAllAttempts(): Promise<Pick<Attempt, 'pieceId' | 'timestamp' | 'durationMs'>[]> {
  return apiGet('/api/attempts/summary')
}

export async function deleteAttempt(id: string): Promise<void> {
  return apiDelete(`/api/attempts/${id}`)
}

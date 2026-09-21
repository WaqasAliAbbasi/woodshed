import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client'
import type { PracticeSession } from './db'

/** Newest-first. `since` (epoch ms) and `limit` are both optional server-side filters — see routes/sessions.ts. */
export async function listSessions(options: { since?: number; limit?: number } = {}): Promise<PracticeSession[]> {
  const params = new URLSearchParams()
  if (options.since !== undefined) params.set('since', String(options.since))
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const query = params.toString()
  return apiGet<PracticeSession[]>(`/api/sessions${query ? `?${query}` : ''}`)
}

/** Logs practice Woodshed didn't witness — see server/queries.ts's `createManualSession` doc comment. No outbox: unlike `recordAttempt`, this is a deliberate foreground action the caller can surface an error for normally. */
export async function createManualSession(input: {
  startedAt: number
  endedAt: number
  label?: string
  pieceId?: string
  note?: string
}): Promise<PracticeSession> {
  return apiPost<PracticeSession>('/api/sessions', input)
}

/**
 * `note`/`label`/`pieceId` can be edited on either kind of session; pass
 * `null` to clear one, omit to leave it unchanged. `startedAt`/`endedAt`
 * are only accepted server-side for a manual session — see
 * routes/sessions.ts, which 400s a time edit on a derived one rather than
 * accepting a value the next recorded attempt would just overwrite.
 */
export async function updateSession(
  id: string,
  updates: { note?: string | null; label?: string | null; pieceId?: string | null; startedAt?: number; endedAt?: number },
): Promise<PracticeSession> {
  return apiPatch<PracticeSession>(`/api/sessions/${id}`, updates)
}

/** Manual sessions only — the server 400s an attempt to delete a derived one. See ConfirmDialog's caller for why a derived session offers "clear note" instead. */
export async function deleteSession(id: string): Promise<void> {
  return apiDelete(`/api/sessions/${id}`)
}

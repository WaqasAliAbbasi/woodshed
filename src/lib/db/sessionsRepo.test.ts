import { beforeEach, describe, expect, it } from 'vitest'
import { installFakeServer } from './__fixtures__/fakeServer'
import { createManualSession, deleteSession, listSessions, updateSession } from './sessionsRepo'
import type { PracticeSession } from './db'

const fakeServer = installFakeServer()

beforeEach(() => {
  fakeServer.reset()
})

function derivedSession(overrides: Partial<PracticeSession> = {}): PracticeSession {
  return {
    id: 'derived-1',
    startedAt: 1000,
    endedAt: 2000,
    source: 'derived',
    createdAt: 1000,
    updatedAt: 1000,
    attemptCount: 2,
    scoredMs: 900,
    pieceIds: ['p1'],
    ...overrides,
  }
}

describe('createManualSession', () => {
  it('creates a manual session and returns it', async () => {
    const session = await createManualSession({ startedAt: 100, endedAt: 200, label: 'Scales', note: 'felt good' })
    expect(session.source).toBe('manual')
    expect(session.label).toBe('Scales')
    expect(session.note).toBe('felt good')
    expect(session.attemptCount).toBe(0)
  })
})

describe('listSessions', () => {
  it('returns sessions newest-first', async () => {
    await createManualSession({ startedAt: 100, endedAt: 200, label: 'earlier' })
    await createManualSession({ startedAt: 500, endedAt: 600, label: 'later' })
    const sessions = await listSessions()
    expect(sessions.map((s) => s.label)).toEqual(['later', 'earlier'])
  })

  it('filters by since', async () => {
    await createManualSession({ startedAt: 100, endedAt: 200, label: 'old' })
    await createManualSession({ startedAt: 5000, endedAt: 5100, label: 'new' })
    const sessions = await listSessions({ since: 1000 })
    expect(sessions.map((s) => s.label)).toEqual(['new'])
  })

  it('respects limit', async () => {
    await createManualSession({ startedAt: 100, endedAt: 200 })
    await createManualSession({ startedAt: 300, endedAt: 400 })
    const sessions = await listSessions({ limit: 1 })
    expect(sessions).toHaveLength(1)
  })
})

describe('updateSession', () => {
  it('sets a note on a derived session', async () => {
    fakeServer.sessions.set('derived-1', derivedSession())
    const updated = await updateSession('derived-1', { note: 'LH jumps in bar 14' })
    expect(updated.note).toBe('LH jumps in bar 14')
  })

  it('clears a note by passing null', async () => {
    fakeServer.sessions.set('derived-1', derivedSession({ note: 'old note' }))
    const updated = await updateSession('derived-1', { note: null })
    expect(updated.note).toBeUndefined()
  })
})

describe('deleteSession', () => {
  it('deletes a manual session', async () => {
    const session = await createManualSession({ startedAt: 100, endedAt: 200 })
    await deleteSession(session.id)
    expect(await listSessions()).toEqual([])
  })

  it('rejects deleting a derived session', async () => {
    fakeServer.sessions.set('derived-1', derivedSession())
    await expect(deleteSession('derived-1')).rejects.toThrow()
  })
})

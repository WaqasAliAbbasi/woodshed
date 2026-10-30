import { describe, expect, it } from 'vitest'
import { openDb } from '../db.ts'
import { createManualSession, exportSessions } from '../queries.ts'
import { createExportKey, resolveExportKey } from './exportKey.ts'
import { createUser } from './session.ts'

describe('export keys', () => {
  it('resolve to their own user only, and are stored hashed', () => {
    const db = openDb(':memory:')
    const alice = createUser(db, 'alice', 'a-good-password')!
    const bob = createUser(db, 'bob', 'a-good-password')!
    const key = createExportKey(db, alice.id, 'life')
    expect(resolveExportKey(db, key)).toBe(alice.id)
    expect(resolveExportKey(db, key.slice(0, -1) + '0')).toBeUndefined()
    expect(resolveExportKey(db, createExportKey(db, bob.id, 'life'))).toBe(bob.id)
    expect(JSON.stringify(db.prepare('SELECT * FROM export_keys').all())).not.toContain(key)
  })

  it('export only that user\'s sessions, with titles but no notes', () => {
    const db = openDb(':memory:')
    const alice = createUser(db, 'alice', 'a-good-password')!
    const bob = createUser(db, 'bob', 'a-good-password')!
    createManualSession(db, bob.id, { startedAt: 1, endedAt: 2, note: 'bob only' })
    createManualSession(db, alice.id, { startedAt: 1000, endedAt: 4000, label: 'lesson', note: 'private' })
    const out = exportSessions(db, alice.id)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ startedAt: 1000, endedAt: 4000, label: 'lesson', source: 'manual', pieces: [] })
    expect(JSON.stringify(out)).not.toContain('private')
    expect(exportSessions(db, alice.id, 2000)).toHaveLength(0)
  })
})

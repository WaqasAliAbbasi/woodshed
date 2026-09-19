import { describe, expect, it } from 'vitest'
import { openDb } from '../db.ts'
import { createUser, findUserByUsername, hashPassword, validateNewUser, verifyPassword } from './session.ts'

function freshDb() {
  return openDb(':memory:')
}

describe('validateNewUser', () => {
  it('accepts a reasonable username and password', () => {
    expect(validateNewUser('alice', 'a-good-password')).toBeUndefined()
  })

  it.each(['ab', 'a'.repeat(33), 'has a space', 'has/slash', ''])('rejects the malformed username %j', (username) => {
    expect(validateNewUser(username, 'a-good-password')).toBeTruthy()
  })

  it('accepts underscores and hyphens in a username', () => {
    expect(validateNewUser('al_ice-2', 'a-good-password')).toBeUndefined()
  })

  it('rejects a too-short password', () => {
    expect(validateNewUser('alice', 'short')).toBeTruthy()
  })
})

describe('createUser', () => {
  it('creates a user findable by username afterward', () => {
    const db = freshDb()
    const user = createUser(db, 'alice', 'a-good-password')
    expect(user?.username).toBe('alice')
    expect(findUserByUsername(db, 'alice')?.id).toBe(user?.id)
  })

  it('stores a hash, never the plaintext password', () => {
    const db = freshDb()
    createUser(db, 'alice', 'a-good-password')
    const stored = findUserByUsername(db, 'alice')
    expect(stored?.passwordHash).not.toBe('a-good-password')
    expect(stored ? verifyPassword('a-good-password', stored.passwordHash) : false).toBe(true)
  })

  it('refuses a second account with an already-taken username', () => {
    const db = freshDb()
    expect(createUser(db, 'alice', 'a-good-password')).toBeTruthy()
    expect(createUser(db, 'alice', 'a-different-password')).toBeUndefined()
    // Only the first account exists — a rejected signup must not touch the row.
    const stored = findUserByUsername(db, 'alice')
    expect(stored ? verifyPassword('a-good-password', stored.passwordHash) : false).toBe(true)
  })

  it('keeps two different usernames independent', () => {
    const db = freshDb()
    const alice = createUser(db, 'alice', 'a-good-password')
    const bob = createUser(db, 'bob', 'another-password')
    expect(alice?.id).not.toBe(bob?.id)
  })
})

describe('hashPassword / verifyPassword', () => {
  it('round-trips the correct password', () => {
    const stored = hashPassword('correct horse battery staple')
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('rejects a wrong password', () => {
    const stored = hashPassword('correct horse battery staple')
    expect(verifyPassword('wrong password', stored)).toBe(false)
  })

  it('rejects a malformed stored hash instead of throwing', () => {
    expect(verifyPassword('anything', 'not-a-valid-stored-hash')).toBe(false)
  })

  it('salts each hash differently, even for the same password', () => {
    expect(hashPassword('same password')).not.toBe(hashPassword('same password'))
  })
})

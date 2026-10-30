import { createHash, randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { NextFunction, Request, Response } from 'express'

// Read-only export keys — see schema.sql's `export_keys`. A key is 24 random bytes, so a plain SHA-256 is enough to
// store (nothing to brute-force, unlike a password) and lets a lookup be a primary-key read.
const hash = (key: string) => createHash('sha256').update(key).digest('hex')

/** Makes a key for `userId` and returns it. This is the only time it exists in the clear. */
export function createExportKey(db: DatabaseSync, userId: string, label: string): string {
  const key = `wsx_${randomBytes(24).toString('hex')}`
  db.prepare('INSERT INTO export_keys (key_hash, user_id, label, created_at) VALUES (?, ?, ?, ?)').run(hash(key), userId, label, Date.now())
  return key
}

export function resolveExportKey(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT user_id FROM export_keys WHERE key_hash = ?').get(hash(key)) as { user_id: string } | undefined
  return row?.user_id
}

/** `Authorization: Bearer wsx_…` -> `req.userId`. Mounted only on the /api/export routes, before the cookie guard. */
export function requireExportKey(db: DatabaseSync) {
  return (req: Request, res: Response, next: NextFunction) => {
    const match = /^Bearer (wsx_[0-9a-f]{48})$/.exec(req.headers.authorization ?? '')
    const userId = match ? resolveExportKey(db, match[1]!) : undefined
    if (!userId) {
      res.status(401).json({ error: 'Invalid export key' })
      return
    }
    req.userId = userId
    next()
  }
}

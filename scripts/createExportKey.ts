#!/usr/bin/env node
/**
 * Makes a read-only export key for a user, printed once (only its hash is stored). The key lets another of the
 * user's apps (life) read that user's practice sessions from GET /api/export/sessions, and nothing else.
 *
 *   node scripts/createExportKey.ts ./data/woodshed.db alice life
 *
 * In production, inside the container:
 *
 *   docker compose exec web node scripts/createExportKey.ts /app/data/woodshed.db alice life
 */
import { createExportKey } from '../server/auth/exportKey.ts'
import { findUserByUsername } from '../server/auth/session.ts'
import { openDb } from '../server/db.ts'

const [, , dbPath, username, label] = process.argv
if (!dbPath || !username || !label) {
  console.error('Usage: node scripts/createExportKey.ts <path-to-db> <username> <label>')
  process.exit(1)
}

const db = openDb(dbPath)
try {
  const user = findUserByUsername(db, username)
  if (!user) {
    console.error(`No user named "${username}".`)
    process.exit(1)
  }
  console.log(createExportKey(db, user.id, label))
} finally {
  db.close()
}

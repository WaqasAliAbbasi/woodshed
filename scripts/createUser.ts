#!/usr/bin/env node
/**
 * Creates a login from the command line — mainly useful for the first
 * account on a fresh instance, or any account creation you'd rather not do
 * through the public `/signup` page. Shares its validation and insert logic
 * with `/api/signup` (see `server/auth/session.ts`'s `createUser`), so an
 * account made either way is identical.
 *
 *   node scripts/createUser.ts ./data/woodshed.db alice 'her password'
 *
 * In production, that means running it inside the container:
 *
 *   docker compose exec web node scripts/createUser.ts /app/data/woodshed.db alice 'her password'
 */
import { createUser, validateNewUser } from '../server/auth/session.ts'
import { openDb } from '../server/db.ts'

const [, , dbPath, username, password] = process.argv
if (!dbPath || !username || !password) {
  console.error("Usage: node scripts/createUser.ts <path-to-db> <username> <password>")
  process.exit(1)
}

const validationError = validateNewUser(username, password)
if (validationError) {
  console.error(validationError)
  process.exit(1)
}

const db = openDb(dbPath)
try {
  const user = createUser(db, username, password)
  if (!user) {
    console.error(`A user named "${username}" already exists.`)
    process.exit(1)
  }
  console.log(`Created user "${username}" (id ${user.id}).`)
} finally {
  db.close()
}

import { getDb, type Attempt } from './db'
import { generateId } from '../id'

export async function recordAttempt(input: Omit<Attempt, 'id' | 'timestamp'>): Promise<Attempt> {
  const db = await getDb()
  const attempt: Attempt = { ...input, id: generateId(), timestamp: Date.now() }
  await db.put('attempts', attempt)
  return attempt
}

export async function listAttemptsForSection(sectionId: string): Promise<Attempt[]> {
  const db = await getDb()
  return db.getAllFromIndex('attempts', 'sectionId', sectionId)
}

export async function listAttemptsForPiece(pieceId: string): Promise<Attempt[]> {
  const db = await getDb()
  return db.getAllFromIndex('attempts', 'pieceId', pieceId)
}

/** All attempts across every piece — used to sort the piece library by recency and total practice time. */
export async function listAllAttempts(): Promise<Attempt[]> {
  const db = await getDb()
  return db.getAll('attempts')
}

export async function deleteAttempt(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('attempts', id)
}

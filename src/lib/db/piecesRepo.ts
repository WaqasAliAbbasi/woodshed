import { getDb, type Piece } from './db'
import { generateId } from '../id'

export async function createPiece(input: Omit<Piece, 'id' | 'createdAt' | 'updatedAt'>): Promise<Piece> {
  const db = await getDb()
  const now = Date.now()
  const piece: Piece = { ...input, id: generateId(), createdAt: now, updatedAt: now }
  await db.put('pieces', piece)
  return piece
}

export async function listPieces(): Promise<Piece[]> {
  const db = await getDb()
  return db.getAllFromIndex('pieces', 'createdAt')
}

export async function getPiece(id: string): Promise<Piece | undefined> {
  const db = await getDb()
  return db.get('pieces', id)
}

export async function deletePiece(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('pieces', id)
}

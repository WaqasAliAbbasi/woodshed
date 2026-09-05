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

export async function renamePiece(id: string, title: string): Promise<Piece> {
  const db = await getDb()
  const piece = await db.get('pieces', id)
  if (!piece) throw new Error(`Piece ${id} not found`)
  const renamed: Piece = { ...piece, title, updatedAt: Date.now() }
  await db.put('pieces', renamed)
  return renamed
}

export async function deletePiece(id: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['pieces', 'sections', 'attempts'], 'readwrite')
  const [sections, attempts] = await Promise.all([
    tx.objectStore('sections').index('pieceId').getAllKeys(id),
    tx.objectStore('attempts').index('pieceId').getAllKeys(id),
  ])
  await Promise.all([
    tx.objectStore('pieces').delete(id),
    ...sections.map((key) => tx.objectStore('sections').delete(key)),
    ...attempts.map((key) => tx.objectStore('attempts').delete(key)),
  ])
  await tx.done
}

import { getDb, type Section } from './db'
import { generateId } from '../id'

export async function createSection(input: Omit<Section, 'id' | 'createdAt'>): Promise<Section> {
  const db = await getDb()
  const section: Section = { ...input, id: generateId(), createdAt: Date.now() }
  await db.put('sections', section)
  return section
}

export async function listSectionsForPiece(pieceId: string): Promise<Section[]> {
  const db = await getDb()
  return db.getAllFromIndex('sections', 'pieceId', pieceId)
}

export async function getSection(id: string): Promise<Section | undefined> {
  const db = await getDb()
  return db.get('sections', id)
}

export async function deleteSection(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('sections', id)
}

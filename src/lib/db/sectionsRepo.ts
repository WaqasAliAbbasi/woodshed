import { apiDelete, apiGet, apiPost, isNotFound } from '../api/client'
import type { Section } from './db'

export async function createSection(input: Omit<Section, 'id' | 'createdAt'>): Promise<Section> {
  return apiPost<Section>('/api/sections', input)
}

export async function listSectionsForPiece(pieceId: string): Promise<Section[]> {
  return apiGet<Section[]>(`/api/pieces/${pieceId}/sections`)
}

export async function getSection(id: string): Promise<Section | undefined> {
  try {
    return await apiGet<Section>(`/api/sections/${id}`)
  } catch (err) {
    if (isNotFound(err)) return undefined
    throw err
  }
}

export async function deleteSection(id: string): Promise<void> {
  return apiDelete(`/api/sections/${id}`)
}

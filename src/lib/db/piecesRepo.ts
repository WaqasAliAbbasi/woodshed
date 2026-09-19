import { apiDelete, apiGet, apiPatch, apiPost, isNotFound } from '../api/client'
import type { Piece } from './db'

/** What the server's `/api/pieces` list returns — everything but `musicXml`, which would make the library-list response scale with every score's XML at once. `getPiece` below still returns the full `Piece`. */
export type PieceSummary = Omit<Piece, 'musicXml'>

export async function createPiece(input: Omit<Piece, 'id' | 'createdAt' | 'updatedAt'>): Promise<Piece> {
  return apiPost<Piece>('/api/pieces', input)
}

export async function listPieces(): Promise<PieceSummary[]> {
  return apiGet<PieceSummary[]>('/api/pieces')
}

export async function getPiece(id: string): Promise<Piece | undefined> {
  try {
    return await apiGet<Piece>(`/api/pieces/${id}`)
  } catch (err) {
    if (isNotFound(err)) return undefined
    throw err
  }
}

/** Returns a summary (no `musicXml`) — see PieceLibrary/App.tsx's RenamableTitle, which merges the new title into the `Piece` it already holds rather than replacing the object wholesale. */
export async function renamePiece(id: string, title: string): Promise<PieceSummary> {
  return apiPatch<PieceSummary>(`/api/pieces/${id}`, { title })
}

export async function deletePiece(id: string): Promise<void> {
  return apiDelete(`/api/pieces/${id}`)
}

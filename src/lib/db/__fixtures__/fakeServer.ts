import { vi } from 'vitest'
import type { Attempt, Piece, Section } from '../db'

/**
 * An in-memory stand-in for `server/`'s REST API, close enough to its real
 * behavior (id generation, `musicXml`-omitted list responses, upsert-by-id
 * on attempts, cascading delete) that `piecesRepo.ts`/`sectionsRepo.ts`/
 * `attemptsRepo.ts` — which now talk to `fetch('/api/...')` instead of
 * IndexedDB directly, see db.ts's doc comment — can be exercised in a test
 * without a real server. Installed by replacing `globalThis.fetch`; call
 * `reset()` between tests instead of reinstalling.
 */
export function installFakeServer() {
  const pieces = new Map<string, Piece>()
  const sections = new Map<string, Section>()
  const attempts = new Map<string, Attempt>()
  let nextId = 0
  const generateId = () => `fake-${++nextId}`

  function json(body: unknown, status = 200): Response {
    if (status === 204) return new Response(null, { status: 204 })
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }

  function pieceSummary(piece: Piece) {
    const { musicXml: _musicXml, ...summary } = piece
    return summary
  }

  async function handle(path: string, method: string, body: unknown): Promise<Response> {
    let m: RegExpMatchArray | null

    if (path === '/api/pieces' && method === 'GET') {
      return json(Array.from(pieces.values()).map(pieceSummary))
    }
    if (path === '/api/pieces' && method === 'POST') {
      const input = body as Omit<Piece, 'id' | 'createdAt' | 'updatedAt'>
      const now = Date.now()
      const piece: Piece = { ...input, id: generateId(), createdAt: now, updatedAt: now }
      pieces.set(piece.id, piece)
      return json(piece, 201)
    }
    if ((m = path.match(/^\/api\/pieces\/([^/]+)$/)) && method === 'GET') {
      const piece = pieces.get(m[1])
      return piece ? json(piece) : json({ error: 'Piece not found' }, 404)
    }
    if ((m = path.match(/^\/api\/pieces\/([^/]+)$/)) && method === 'PATCH') {
      const piece = pieces.get(m[1])
      if (!piece) return json({ error: 'Piece not found' }, 404)
      const { title, composer } = body as { title?: string; composer?: string }
      if (title) {
        piece.title = title
        if (composer !== undefined) piece.composer = composer.trim() || undefined
        piece.updatedAt = Date.now()
      }
      return json(pieceSummary(piece))
    }
    if ((m = path.match(/^\/api\/pieces\/([^/]+)$/)) && method === 'DELETE') {
      if (!pieces.delete(m[1])) return json({ error: 'Piece not found' }, 404)
      for (const s of Array.from(sections.values())) if (s.pieceId === m[1]) sections.delete(s.id)
      for (const a of Array.from(attempts.values())) if (a.pieceId === m[1]) attempts.delete(a.id)
      return json(undefined, 204)
    }
    if ((m = path.match(/^\/api\/pieces\/([^/]+)\/sections$/)) && method === 'GET') {
      return json(Array.from(sections.values()).filter((s) => s.pieceId === m![1]))
    }
    if ((m = path.match(/^\/api\/pieces\/([^/]+)\/attempts$/)) && method === 'GET') {
      return json(
        Array.from(attempts.values())
          .filter((a) => a.pieceId === m![1])
          .sort((a, b) => a.timestamp - b.timestamp),
      )
    }
    if (path === '/api/sections' && method === 'POST') {
      const input = body as Omit<Section, 'id' | 'createdAt'>
      const section: Section = { ...input, id: generateId(), createdAt: Date.now() }
      sections.set(section.id, section)
      return json(section, 201)
    }
    if ((m = path.match(/^\/api\/sections\/([^/]+)$/)) && method === 'GET') {
      const section = sections.get(m[1])
      return section ? json(section) : json({ error: 'Section not found' }, 404)
    }
    if ((m = path.match(/^\/api\/sections\/([^/]+)$/)) && method === 'DELETE') {
      if (!sections.delete(m[1])) return json({ error: 'Section not found' }, 404)
      return json(undefined, 204)
    }
    if ((m = path.match(/^\/api\/sections\/([^/]+)\/attempts$/)) && method === 'GET') {
      return json(
        Array.from(attempts.values())
          .filter((a) => a.sectionId === m![1])
          .sort((a, b) => a.timestamp - b.timestamp),
      )
    }
    if (path === '/api/attempts' && method === 'POST') {
      const attempt = body as Attempt
      if (!attempts.has(attempt.id)) attempts.set(attempt.id, attempt)
      return json(undefined, 204)
    }
    if ((m = path.match(/^\/api\/attempts\/([^/]+)$/)) && method === 'DELETE') {
      if (!attempts.delete(m[1])) return json({ error: 'Attempt not found' }, 404)
      return json(undefined, 204)
    }
    if (path === '/api/attempts/summary' && method === 'GET') {
      return json(Array.from(attempts.values()).map((a) => ({ pieceId: a.pieceId, timestamp: a.timestamp, durationMs: a.durationMs })))
    }

    throw new Error(`fakeServer: unhandled ${method} ${path}`)
  }

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body as string) : undefined
    return handle(path, method, body)
  })

  vi.stubGlobal('fetch', fetchMock)

  return {
    reset() {
      pieces.clear()
      sections.clear()
      attempts.clear()
      nextId = 0
      fetchMock.mockClear()
    },
    pieces,
    sections,
    attempts,
  }
}

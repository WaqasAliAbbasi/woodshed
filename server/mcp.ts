import type { DatabaseSync } from 'node:sqlite'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import express, { type Router } from 'express'
import { z } from 'zod'
import { summarizeSectionProgress } from '../src/lib/coach/pieceProgress.ts'
import { SECTION_STATUS_LABEL } from '../src/lib/coach/suggestNextStep.ts'
import { computeStreak } from '../src/lib/streak.ts'
import * as queries from './queries.ts'

/**
 * Registers the read-only tools Claude gets over MCP, scoped to one
 * `userId` — the user who clicked Allow on the consent screen for the
 * access token this request carries (see oauth/provider.ts's `extra:
 * {userId}` and the /mcp handler below, which is what makes a fresh
 * `McpServer` per request rather than one shared instance: the user a
 * given call is scoped to isn't known until that request's token is
 * verified). Reuses the exact same scoring/coaching logic the app's own UI
 * is built on (`summarizeSectionProgress`, `computeStreak`), so "what does
 * Claude see" and "what does the app show" can't quietly drift apart. No
 * write tools: there's no practice-data mutation an LLM should be doing on
 * your behalf here, only reading it.
 */
function buildMcpServer(db: DatabaseSync, userId: string): McpServer {
  const server = new McpServer({ name: 'woodshed', version: '1.0.0' })

  server.registerTool(
    'list_pieces',
    {
      title: 'List pieces',
      description: "List every piece in the user's Woodshed library, with when each was last practiced.",
      inputSchema: {},
    },
    async () => {
      const pieces = queries.listPieceOverviews(db, userId)
      return { content: [{ type: 'text', text: JSON.stringify(pieces, null, 2) }] }
    },
  )

  server.registerTool(
    'practice_history',
    {
      title: 'Practice history',
      description: 'Recent practice attempts, most recent first — optionally scoped to one piece by id (see list_pieces).',
      inputSchema: {
        pieceId: z.string().optional().describe('Limit to one piece, by the id from list_pieces. Omit for the whole library.'),
        limit: z.number().int().positive().max(100).optional().describe('Max attempts to return. Defaults to 20.'),
      },
    },
    async ({ pieceId, limit }) => {
      const attempts = queries.listRecentAttempts(db, userId, { pieceId, limit: limit ?? 20 })
      return { content: [{ type: 'text', text: JSON.stringify(attempts, null, 2) }] }
    },
  )

  server.registerTool(
    'streak',
    {
      title: 'Practice streak',
      description: 'The current and longest consecutive-day practice streak, across the whole library.',
      inputSchema: {},
    },
    async () => {
      const attempts = queries.listAttemptSummaries(db, userId)
      const result = computeStreak(attempts)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ...result, totalAttempts: attempts.length }, null, 2),
          },
        ],
      }
    },
  )

  server.registerTool(
    'section_progress',
    {
      title: 'Section progress',
      description: 'Per-section practice status (struggling / progressing / ready) for one piece, struggling-first.',
      inputSchema: {
        pieceId: z.string().describe('A piece id from list_pieces.'),
      },
    },
    async ({ pieceId }) => {
      const sections = queries.listSectionsForPiece(db, userId, pieceId)
      const attempts = queries.listAttemptsForPiece(db, userId, pieceId)
      // An unset target reads as undefined rather than being defaulted here:
      // the stand-in is the score's own marked tempo, which lives in the
      // MusicXML and only the client parses. Inventing a number server-side
      // would report a `clearedAtTarget` the app never showed.
      const targetTempoBpm = queries.getPieceSummary(db, userId, pieceId)?.targetTempoBpm
      const progress = summarizeSectionProgress(sections, attempts, targetTempoBpm)
      const summary = progress.map((p) => ({
        sectionLabel: p.section.label,
        status: SECTION_STATUS_LABEL[p.status],
        attemptCount: p.attemptCount,
        latestTempoBpm: p.latest.tempoBpm,
        latestPitchAccuracy: p.latest.aggregate.pitchAccuracy,
        latestTimingAccuracy: p.latest.aggregate.timingAccuracy,
        targetTempoBpm,
        clearedAtTarget: p.clearedAtTarget,
      }))
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] }
    },
  )

  return server
}

/** `AuthInfo.extra` is `Record<string, unknown> | undefined` — this is the one place that trusts it to hold a `userId` string, which only ever got there via `oauth/provider.ts`'s own token issuance (see `verifyAccessToken`). */
function extractUserId(extra: Record<string, unknown> | undefined): string | undefined {
  const userId = extra?.userId
  return typeof userId === 'string' ? userId : undefined
}

/**
 * `/mcp` — the Streamable HTTP MCP endpoint, bearer-token gated by the
 * OAuth provider in oauth/provider.ts. Stateless: a fresh `McpServer` +
 * transport per request (`sessionIdGenerator: undefined`), which is the
 * documented-safe shape for stateless mode — and also the natural place to
 * bind the request's tools to whichever user the verified token belongs to.
 * This app's tool-call volume from a handful of people never makes the
 * per-request setup cost noticeable.
 */
export function createMcpRouter(db: DatabaseSync, oauthProvider: OAuthServerProvider): Router {
  const router = express.Router()

  router.use(
    '/mcp',
    express.json(),
    requireBearerAuth({ verifier: oauthProvider, resourceMetadataUrl: '/.well-known/oauth-protected-resource/mcp' }),
  )

  router.post('/mcp', async (req, res) => {
    const userId = extractUserId(req.auth?.extra)
    if (!userId) {
      // Should be unreachable — requireBearerAuth already rejected any
      // token verifyAccessToken didn't return successfully, and every
      // token this server issues carries a userId. Failing closed rather
      // than falling back to "no user" is the only acceptable behavior for
      // a per-user data boundary.
      res.status(401).json({ error: 'Token carries no user' })
      return
    }
    const server = buildMcpServer(db, userId)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })

  // GET/DELETE on /mcp are only meaningful for the stateful (SSE-resumable)
  // mode this server doesn't use — respond per the transport spec instead
  // of letting them 404 through the SPA fallback.
  router.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed — this server does not support the SSE stream.' })
  })
  router.delete('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Method not allowed.' })
  })

  return router
}

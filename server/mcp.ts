import type { DatabaseSync } from 'node:sqlite'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import express, { type Router } from 'express'
import { z } from 'zod'
import type { AttemptAggregate, PracticeMode } from '../src/lib/scoring/types.ts'
import { isTimedSection, summarizeSectionProgress } from '../src/lib/coach/pieceProgress.ts'
import { isReadyToStopLooping, SECTION_STATUS_LABEL, timingQuality } from '../src/lib/coach/suggestNextStep.ts'
import { computeStreak } from '../src/lib/streak.ts'
import * as queries from './queries.ts'

/**
 * Sent once at `initialize`, before any tool is called. Everything here is
 * something a caller would otherwise have to *infer* from a wall of
 * numbers — and would infer wrongly. The Notes-mode paragraph is the load-
 * bearing one: a completed SequenceMatcher attempt is 100% pitch-accurate
 * by construction (see the matcher's own docs), so a coach reading raw
 * history sees a run of perfect scores and congratulates the student on
 * nothing. Stating the thresholds keeps advice here consistent with the
 * status the app itself shows for the same attempt.
 */
const SERVER_INSTRUCTIONS = `Woodshed is this user's piano practice log. They upload a score, drag out a *section* (a range of measures), and play it on a MIDI keyboard; each run is an *attempt*, scored note by note. These tools are read-only — you can see the practice record, not change it.

Reading the numbers (all accuracies are whole-number percentages):
- pitchAccuracyPct — how many of the expected notes were played correctly.
- rhythmAccuracyPct — of the notes played correctly, how many landed on time. This is the rhythm signal, and what the status thresholds below are tuned against.
- onTimePct — on-time notes as a share of *all* expected notes. It falls when few notes were played at all, even if those were well timed, so prefer rhythmAccuracyPct when judging rhythm alone.
- The on-time window is deliberately forgiving — this is a practice tool, not a rhythm game. Don't treat a near miss as a serious fault.
- handBalance compares average MIDI velocity between the hands (0-127). It's a loudness-balance check only; it's absent when there's nothing to compare (one hand practiced alone, a single-staff piece, or an input device with no real velocity).

Two practice modes, which score fundamentally different things:
- metronome — tempo-locked: count-in, click track, notes scored against a fixed timeline. Every pitch and timing figure means what it says, and tempoBpm is real.
- notes — untimed reading practice. The passage only advances once the right note is played, so a *completed* attempt is always 100% pitch-accurate and has no timing meaning whatsoever; its tempoBpm is whatever the dial happened to read and should be ignored. The real signals are wrongNotes (fumbles before finding the right note; 0 is a clean pass) and, on an aborted attempt, passageCompletedPct. Never praise a Notes-mode attempt for pitch accuracy, and never compare its tempo to a target.

Section status is computed from the most recent attempt, by the same rule the app's own UI shows: struggling below 80% pitch or 70% rhythm, ready at 95% pitch and 85% rhythm or better, progressing in between. It is null for an untimed section, where that scale means nothing — judge those on cleanPass and wrongNotes instead.

clearedAtTarget means the section has at some point been played at or above the piece's target tempo, run to the end, and clean by the "ready" bar — the nearest thing here to "they've got this". null means the question doesn't apply: an untimed section, or no target tempo set on the piece.

Timestamps are UTC instants; the streak's lastPracticedDay is a calendar practice day, running 4am to 4am. This server doesn't know the student's timezone, so treat day counts near midnight as approximate.`

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Timestamps reach the caller as an ISO-8601 instant plus a whole-day age,
 * rather than the epoch milliseconds the database stores. A coach reasons
 * in "three days ago"; making it do that arithmetic itself is both wasted
 * tokens and a chance to get it wrong. UTC, because this process has no
 * idea what timezone the student is in (the container sets no TZ, see
 * compose.yml) — the same limitation `computeStreak`'s day boundaries
 * already run under.
 */
function describeInstant(timestampMs: number, now: number): { at: string; daysAgo: number } {
  const utcDay = (ms: number) => Math.floor(ms / MS_PER_DAY)
  return { at: new Date(timestampMs).toISOString(), daysAgo: utcDay(now) - utcDay(timestampMs) }
}

/**
 * `computeStreak`'s `lastPracticedDay` is a practice-*day key* — local
 * midnight with the 4am boundary already applied (see streak.ts) — not an
 * instant, so it deliberately doesn't go through `describeInstant`:
 * rendering a local midnight as a UTC timestamp lands it on the previous
 * calendar date whenever the server clock runs ahead of UTC, which would
 * have the streak and `list_pieces` disagree about the same session by a
 * day. Formatted by the same local components it was built from instead.
 */
function describeDayKey(dayKeyMs: number, now: number): { on: string; daysAgo: number } {
  const day = new Date(dayKeyMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  const todayMidnight = new Date(now)
  todayMidnight.setHours(0, 0, 0, 0)
  return {
    on: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
    // Whole days apart, not a raw ms division, so a DST change (when two
    // midnights are 23h or 25h apart) doesn't round to the wrong day.
    daysAgo: Math.round((todayMidnight.getTime() - dayKeyMs) / MS_PER_DAY),
  }
}

/** 0-1 accuracy as a whole-number percentage — a coach reasons in "82%", not 0.8235294117647059, and the extra digits are noise in every direction. */
function percent(value: number): number {
  return Math.round(value * 100)
}

function describeHandBalance(aggregate: AttemptAggregate) {
  const balance = aggregate.handBalance
  if (!balance) return undefined
  return {
    leftAvgVelocity: Math.round(balance.leftAvgVelocity),
    rightAvgVelocity: Math.round(balance.rightAvgVelocity),
    leftNoteCount: balance.leftNoteCount,
    rightNoteCount: balance.rightNoteCount,
  }
}

/**
 * The figures worth reporting for one attempt, which depends on the mode it
 * was played in — this is the whole reason `listRecentAttempts` hands back
 * a raw `AttemptAggregate` instead of pre-flattening two accuracy numbers.
 *
 * An untimed (Notes-mode) attempt has no honest timing figure at all, and
 * its pitch accuracy is 100% for any run that finished, so emitting those
 * fields at all would be inviting a wrong reading. What that mode actually
 * measures is how many wrong notes were fumbled on the way through
 * (`wrongNotes`, the same signal `isReadyToStopLooping` gates looping on)
 * and, for a run that was given up on, how far it got.
 */
function describeScore(aggregate: AttemptAggregate, section: { timed: boolean; aborted: boolean }) {
  if (!section.timed) {
    return {
      passageCompletedPct: percent(aggregate.pitchAccuracy),
      wrongNotes: aggregate.extra,
      // The app's own bar for an untimed run, reused rather than restated
      // so the two can't drift — plus the abort check it doesn't make,
      // since it's only ever consulted on a run that finished, and a run
      // given up on early hasn't passed anything cleanly.
      cleanPass: !section.aborted && isReadyToStopLooping('notes', aggregate),
      notesExpected: aggregate.expected,
      handBalance: describeHandBalance(aggregate),
    }
  }
  return {
    pitchAccuracyPct: percent(aggregate.pitchAccuracy),
    rhythmAccuracyPct: percent(timingQuality(aggregate)),
    onTimePct: percent(aggregate.timingAccuracy),
    notesExpected: aggregate.expected,
    missedNotes: aggregate.missed,
    wrongNotes: aggregate.extra,
    earlyNotes: aggregate.early,
    lateNotes: aggregate.late,
    handBalance: describeHandBalance(aggregate),
  }
}

/** Sections predating each feature carry no stored value — the same defaults the rest of the app reads them with, spelled out here so a caller never has to interpret a missing field. */
function sectionDefaults(mode: PracticeMode | undefined, handFilter: string | undefined) {
  return { mode: mode ?? 'metronome', handFilter: handFilter ?? 'both' }
}

/** Every tool returns one JSON document; this is the one place that decides how. */
function jsonResult(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] }
}

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
  const server = new McpServer({ name: 'woodshed', version: '1.0.0' }, { instructions: SERVER_INSTRUCTIONS })

  server.registerTool(
    'list_pieces',
    {
      title: 'List pieces',
      description:
        "List every piece in the user's Woodshed library, with when each was last practiced. A piece with no `lastPracticed` has never been played. Start here — the other tools take a `pieceId` from this list.",
      inputSchema: {},
    },
    async () => {
      const now = Date.now()
      const pieces = queries.listPieceOverviews(db, userId).map((piece) => ({
        id: piece.id,
        title: piece.title,
        composer: piece.composer,
        measureCount: piece.measureCount,
        lastPracticed: piece.lastPracticedAt === undefined ? undefined : describeInstant(piece.lastPracticedAt, now),
      }))
      return jsonResult(pieces)
    },
  )

  server.registerTool(
    'practice_history',
    {
      title: 'Practice history',
      description:
        'Recent practice attempts, most recent first — optionally scoped to one piece by id (see list_pieces). Which score fields come back depends on the attempt\'s mode; see this server\'s instructions before reading them.',
      inputSchema: {
        pieceId: z.string().optional().describe('Limit to one piece, by the id from list_pieces. Omit for the whole library.'),
        limit: z.number().int().positive().max(100).optional().describe('Max attempts to return. Defaults to 20.'),
      },
    },
    async ({ pieceId, limit }) => {
      const now = Date.now()
      const attempts = queries.listRecentAttempts(db, userId, { pieceId, limit: limit ?? 20 }).map((attempt) => {
        const { mode, handFilter } = sectionDefaults(attempt.mode, attempt.handFilter)
        return {
          ...describeInstant(attempt.timestamp, now),
          pieceId: attempt.pieceId,
          pieceTitle: attempt.pieceTitle,
          sectionId: attempt.sectionId,
          sectionLabel: attempt.sectionLabel,
          measures: `${attempt.startMeasure}-${attempt.endMeasure}`,
          mode,
          handFilter,
          // Omitted rather than reported as a meaningless number in an
          // untimed section, where the dial's reading was never played
          // against anything — see SERVER_INSTRUCTIONS.
          tempoBpm: mode === 'metronome' ? attempt.tempoBpm : undefined,
          aborted: attempt.aborted,
          durationSec: attempt.durationMs === undefined ? undefined : Math.round(attempt.durationMs / 1000),
          ...describeScore(attempt.aggregate, { timed: mode === 'metronome', aborted: attempt.aborted }),
        }
      })
      return jsonResult(attempts)
    },
  )

  server.registerTool(
    'streak',
    {
      title: 'Practice streak',
      description:
        'The current and longest consecutive-day practice streak, across the whole library. A practice day runs from 4am to 4am, so a late-night session counts for the day it felt like.',
      inputSchema: {},
    },
    async () => {
      const now = Date.now()
      const attempts = queries.listAttemptSummaries(db, userId)
      const { current, longest, lastPracticedDay } = computeStreak(attempts, now)
      return jsonResult({
        currentDays: current,
        longestDays: longest,
        lastPracticedDay: lastPracticedDay === undefined ? undefined : describeDayKey(lastPracticedDay, now),
        totalAttempts: attempts.length,
      })
    },
  )

  server.registerTool(
    'section_progress',
    {
      title: 'Section progress',
      description:
        'Per-section practice status (struggling / progressing / ready) for one piece, struggling-first — the list doubles as a practice priority queue. Sections that exist but have never been played are omitted.',
      inputSchema: {
        pieceId: z.string().describe('A piece id from list_pieces.'),
      },
    },
    async ({ pieceId }) => {
      const now = Date.now()
      const sections = queries.listSectionsForPiece(db, userId, pieceId)
      const attempts = queries.listAttemptsForPiece(db, userId, pieceId)
      // An unset target reads as undefined rather than being defaulted here:
      // the stand-in is the score's own marked tempo, which lives in the
      // MusicXML and only the client parses. Inventing a number server-side
      // would report a `clearedAtTarget` the app never showed.
      const targetTempoBpm = queries.getPieceSummary(db, userId, pieceId)?.targetTempoBpm
      const progress = summarizeSectionProgress(sections, attempts, targetTempoBpm)
      const summary = progress.map((p) => {
        const timed = isTimedSection(p.section)
        const { mode, handFilter } = sectionDefaults(p.section.mode, p.section.handFilter)
        return {
          sectionId: p.section.id,
          sectionLabel: p.section.label,
          measures: `${p.section.startMeasure}-${p.section.endMeasure}`,
          mode,
          handFilter,
          // `null` for an untimed section rather than the struggling/
          // progressing/ready `classifyAccuracy` returns for it. That scale
          // is a judgement about pitch *and* rhythm, and a completed
          // Notes-mode attempt scores 100% on both by construction — so it
          // would read "Ready" the first time the section was ever played.
          // Same call PracticeWorkspace's measure shading makes: leave
          // untimed practice out of a tempo-graded scale instead of
          // grading it against a bar it was never played against.
          status: timed ? SECTION_STATUS_LABEL[p.status] : null,
          attemptCount: p.attemptCount,
          lastPracticed: describeInstant(p.latest.timestamp, now),
          latestTempoBpm: timed ? p.latest.tempoBpm : undefined,
          targetTempoBpm: timed ? targetTempoBpm : undefined,
          // `null`, not `false`, when the question doesn't apply — an
          // untimed section can never clear a tempo bar (see
          // `clearedAtTarget`'s own doc), and neither can any section of a
          // piece with no target set. Reporting `false` for those reads as
          // "not got it yet", which is a different and wrong claim.
          clearedAtTarget: timed && targetTempoBpm !== undefined ? p.clearedAtTarget : null,
          latest: describeScore(p.latest.aggregate, { timed, aborted: p.latest.aborted }),
        }
      })
      return jsonResult(summary)
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

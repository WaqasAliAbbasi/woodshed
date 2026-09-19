# Woodshed

A React/TypeScript SPA backed by a small Node server — see `README.md` for
what it does. Everything a user creates (uploaded pieces, practice sections,
attempt history) is stored server-side in SQLite (`server/`), scoped per
user (`users` table — this instance can be shared with more than one
person). The browser's IndexedDB (`src/lib/db/db.ts`) is *not* the source
of truth anymore — it's just a write-behind outbox for finished attempts
(see `attemptsRepo.ts`). Don't add a new client-side feature that expects
IndexedDB to hold real data; talk to `/api/*` instead (see `src/lib/api/client.ts`
and the existing `*Repo.ts` files for the pattern).

## Commands

```bash
npm run dev            # vite dev server, localhost only, plain HTTP
npm run dev:https      # also binds the LAN + self-signed cert — needed to test
                        # Web MIDI or PWA install from another device (e.g. an iPad)
npm run server          # node server/index.ts — the backend, port 3000 by default
npm run server:dev      # same, via `node --watch` for auto-restart
npm test                # vitest run
npm run lint             # oxlint (covers server/ and scripts/ too)
npx tsc -b               # typecheck client + server + scripts (part of `npm run build`)
npm run build            # tsc -b && vite build -> dist/, served by the server in production
node scripts/createUser.ts <db-path> <username> <password>   # create a login
```

`npm run dev` (the client) and `npm run server` (the backend) are two
separate processes in local dev — Vite doesn't proxy `/api` to the server,
so run both and point a browser at whichever one you're testing (the
server also serves the *built* client from `dist/`, so `npm run build &&
npm run server` exercises the real production path in one process).

Test files are co-located as `*.test.ts`/`*.test.tsx` next to what they
cover. MusicXML fixtures live in `src/lib/musicxml/__fixtures__/`. Tests for
the `*Repo.ts` files mock the server via `src/lib/db/__fixtures__/fakeServer.ts`
(an in-memory stand-in for `/api/*`) rather than hitting a real server;
`recordAttempt`'s outbox write is the one thing that still uses real
IndexedDB (`fake-indexeddb`) in those tests, since it still is one.

## Architecture

**Data flow, upload to attempt:** a `.musicxml`/`.mxl` file is parsed
(`lib/musicxml/loadMxl.ts`, `loadScore.ts`) and rendered by
OpenSheetMusicDisplay (`components/ScoreViewer`). The user drags a measure
range on the rendered score, picks a hand filter / tempo / mode, and
`PracticeWorkspace` hands that off to `PracticeSession`, whose state machine
(`practiceMachine.ts`) drives: `SectionConfigured` → `CountingIn` →
`Attempting` → `AttemptScoring` → `AttemptComplete`. Each note played comes
in as a Web MIDI event and is fed to whichever matcher the mode uses (see
below); the attempt's final `AttemptAggregate` + `NoteResult[]` get persisted
via `attemptsRepo.ts`.

**Two independent scoring engines** (`lib/scoring/`), because the two
practice modes score fundamentally different things:

- `NoteMatcher` (Metronome mode) — clock-driven. Notes are expected at fixed
  onset times (`buildExpectedTimeline.ts`); a played note matches the
  nearest still-open expected note within `ACCEPT_MS`, and lands `onTime` if
  within `ON_TIME_MS` of the onset, else `early`/`late`. `sweepMissed()` is
  driven externally by a `requestAnimationFrame` loop to close out notes
  whose window has passed.
- `SequenceMatcher` (Notes mode) — order-driven, no clock. Chords are
  expected strictly in sequence; a wrong note is flagged but does *not*
  advance past the current chord — you must play it right to move on. A
  completed, unaborted attempt therefore always has 100% pitch accuracy by
  construction (see `isReadyToStopLooping`'s doc comment for how the coach
  works around that).

Both produce the same `NoteResult`/`AttemptAggregate` shape
(`lib/scoring/types.ts`, `aggregate.ts`) so the rest of the app (history,
coaching, UI) doesn't need to know which mode produced a result.

**Clock correlation** (`lib/clock/audioClock.ts`): MIDI timestamps are on
the `performance.now()` clock; Web Audio scheduling is on
`AudioContext.currentTime` — a different clock and epoch. `correlateClock()`
derives the offset between them once per attempt; comparing the two clocks
directly produces systematically-wrong timing scores. The metronome itself
(`clock/metronome.ts`) is a classic lookahead scheduler so clicks stay
sample-accurate regardless of JS timer jitter.

**Coloring is a shared vocabulary, not a per-component choice.**
`lib/theme.ts` exports `CORRECT_COLOR`/`WRONG_COLOR`/`MISTIMED_COLOR`/
`PROGRESSING_COLOR`, used identically by live per-note feedback
(`PracticeSession`) and the whole-piece progress heatmap (`ScoreViewer`) —
green always means the same thing everywhere. In Metronome mode, notes are
*not* colored live as they're played (deliberately — see the comments in
`PracticeSession`'s MIDI handler); they're all colored at once when the
attempt finalizes, so the player stays focused on the music instead of
watching the score for right/wrong in real time. Notes mode does color
live, since SequenceMatcher's advance-on-correct design makes that the
point.

**Coaching** (`lib/coach/`) is a small rule-based layer, not anything
learned: `classifyAccuracy` buckets an attempt into
struggling/progressing/ready from fixed accuracy thresholds;
`suggestNextStep` turns the most recent attempt into a one-line suggestion;
`pieceProgress.ts` rolls per-section history up into the heatmap. See
`docs/coaching-gaps.md` for a written assessment of where this — and the
scoring pipeline generally — still falls short pedagogically.

**Server** (`server/`, plain TypeScript run unbundled via Node's native
type-stripping — no build step, no `tsx`, see `index.ts`'s own comment):

- `db.ts` + `schema.sql` — `node:sqlite` (not `better-sqlite3`: the client
  Dockerfile's `npm ci --ignore-scripts` would silently skip a native
  addon's compile step). Schema is applied idempotently at boot
  (`CREATE TABLE IF NOT EXISTS` throughout) — there's no migration
  framework; a real schema change against live data needs an actual
  expand/contract step added to `schema.sql`, not an in-place edit.
- `queries.ts` — the one data-access layer both `routes/` (REST) and
  `mcp.ts` (MCP tools) call into. Every function takes `userId` and every
  query is scoped by it; there's deliberately no "fetch this row by id,
  unscoped" function anywhere in the file.
- `auth/session.ts` — username+password login (`users` table). Signup is
  open (`POST /api/signup`, rate-limited — see index.ts); `createUser`/
  `validateNewUser` here are the shared logic both that route and
  `scripts/createUser.ts`'s command-line path call into, so there's exactly
  one place a `users` row ever gets inserted. Login itself is an opaque
  session token in an HttpOnly cookie; `requireSession` middleware sets
  `req.userId`, `getUserId(req)` is how routes read it back.
- `oauth/` + `mcp.ts` — this app *is* the OAuth 2.1 authorization server
  for its own `/mcp` endpoint (via `@modelcontextprotocol/sdk`'s
  `mcpAuthRouter`), not a resource server pointed at someone else's. A
  client (Claude.ai) registers itself through Dynamic Client Registration;
  `/oauth/consent` is where a logged-in user approves it, which is also the
  only place a user id enters the OAuth code/token chain (see
  `provider.ts`'s doc comment on why `authorize()` itself can't check the
  session cookie). Deliberately read-only tools — reuses
  `summarizeSectionProgress`/`computeStreak`/etc. directly from
  `src/lib/coach/` and `src/lib/streak.ts` rather than duplicating that
  logic, which is why those modules use explicit `.ts` import extensions
  unlike the rest of the client codebase (Node's ESM loader needs them;
  Vite doesn't care either way).
- No Traefik/`admin-auth@file` basic-auth in front of any of this (see
  `compose.yml`) — a basic-auth 401 would break the MCP OAuth handshake
  before it ever reached the app.

## Things worth knowing before changing code

- **iOS/iPadOS has no Web MIDI support in any browser, Safari included.**
  `lib/platform.ts`'s `isIOS()` and the computer-keyboard fallback
  (`InputSourceSelector`) exist because of this, not as a nice-to-have —
  don't assume Web MIDI is always available.
- **The SQLite database is real user data**, not a fixture — this app is
  live (see `compose.yml`) and `server/schema.sql` is the source of truth
  now. It's bind-mounted at `./data` specifically so hub's nightly backup
  (which only walks `/srv/*/data`) can see it; a named volume would be
  invisible to that backup. Several `Attempt`/`Section` fields
  (`handFilter`, `mode`, `durationMs`) are still optional client-side types
  because they're absent on records that predate a feature — that history
  didn't change shape when it moved server-side, only where it lives.
- **The client's IndexedDB still holds a real, if smaller, promise**: every
  attempt written there via the outbox (`attemptsRepo.ts`) must eventually
  reach the server, or it's lost the moment that browser's storage is
  cleared. `DB_VERSION` bumps there still need the same care as before
  (`db.ts`'s `upgrade()`, gated on `oldVersion`) — it's a smaller surface
  now, not a deprecated one.
- **No responsive breakpoints existed before the iPad-landscape fix** — the
  layout (`App.css`) is a single fixed-width column by default. If you add
  UI, check it at both a phone-portrait width and a landscape-tablet width
  (≥860px), since the two can behave very differently once content wraps.
- Timing tolerances (`ON_TIME_MS`, `ACCEPT_MS` in `lib/scoring/matcher.ts`)
  are tuned for a forgiving practice tool, not a rhythm-game-tight
  competition — see the comments on those constants before tightening them
  back up.

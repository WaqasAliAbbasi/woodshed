# Woodshed

A browser-based practice companion for piano/keyboard: upload a MusicXML
score, play along on a real MIDI keyboard, and get per-note pitch and timing
feedback right on the sheet music. Practice happens on whatever machine is
wired to your MIDI keyboard; a small backend (`server/`) keeps every piece,
section, and attempt in one place so your history, streak, and progress are
also reachable from a phone (`/dashboard`) or from Claude over MCP — not
just from the browser you practiced in.

Live at [woodshed.waqasali.dev](https://woodshed.waqasali.dev). Log in is
per-user — sign up at `/signup`, or a fresh account can be scripted with
`scripts/createUser.ts` — so this can be shared with someone else without
seeing their library or theirs seeing yours.

## What it does

- **Upload a piece.** Any MusicXML file (`.musicxml`, `.xml`, or compressed
  `.mxl`) renders as real sheet music via
  [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/).
- **Pick a section.** Click-drag a measure range on the score, choose a hand
  to isolate (left/right/both, for pieces with more than one staff), and set
  a tempo — it defaults to the piece's own marked tempo.
- **Practice in one of two modes:**
  - **Metronome** — a count-in and click track set the tempo; play along and
    each note is scored for both pitch and onset timing.
  - **Notes** — no clock. The passage only advances once you play the
    correct note(s), so you can work out fingering and pitch before adding
    tempo pressure.
- **Play along on real MIDI hardware** (Web MIDI, so Chrome/Edge/Firefox) or
  fall back to the computer keyboard when a browser doesn't support it — that
  includes every browser on iOS/iPadOS, which has no Web MIDI support at all
  (Safari included). The app links out to a workaround for iPad users who
  want real hardware.
- **Get a green/amber/red readout after each attempt**: right pitch and
  on-time in green, right pitch but early/late in amber, missed in red — so
  you can see exactly which notes need work, not just an aggregate score.
- **Loop a section until it's ready**, track a coaching status
  (struggling/progressing/ready) per section, and see a whole-piece progress
  heatmap plus a history log of past attempts.
- **Check your streak and progress from a phone** at `/dashboard` — a
  read-only view (no piano needed) built from the same practice data.
- **Let Claude read your practice history over MCP.** `/mcp` is a
  Streamable HTTP MCP server with `list_pieces`, `practice_history`,
  `streak`, and `section_progress` tools, authenticated via OAuth 2.1 — add
  it as a custom connector at [claude.ai](https://claude.ai) (or in Claude
  Code) pointed at `https://woodshed.waqasali.dev/mcp` and approve it once
  you're logged in.

## Getting started

```bash
npm install
node scripts/createUser.ts ./data/woodshed.db yourname 'a password'
npm run dev       # http://localhost:5173
```

`npm run dev` runs the Vite dev server and the backend (`:3000`) together
as one command (see `package.json` — `concurrently`, and `vite.config.ts`'s
`server.proxy`, which forwards `/api`, `/login`, `/signup`, `/oauth`,
`/mcp`, and `/.well-known` from the Vite origin to the backend, so the
browser only ever talks to `:5173` and the session cookie sticks to that
one origin). Run just the client with `npm run dev:client`, or just the
backend with `npm run server:dev`, if you need them separately.
`createUser.ts` needs to run once, against whatever `DB_PATH` the server
will use (`./data/woodshed.db` by default), before you can log in.

Web MIDI requires a "secure context" (HTTPS, or `localhost`). Plain `npm run
dev` is fine on the machine you're developing on. To test from another
device on your network (e.g. an iPad with a MIDI keyboard), use:

```bash
npm run dev:https
```

This also binds to your LAN address and serves a self-signed cert. (The
server itself doesn't need an HTTPS variant for this — only Web MIDI does.)

## Testing and linting

```bash
npm test        # vitest
npm run lint    # oxlint
npx tsc -b      # typecheck (also runs as part of `npm run build`)
```

## Building and deploying

```bash
npm run build    # -> dist/, the client bundle
npm run server   # serves dist/ *and* the API/MCP/OAuth routes, on :3000
```

The `Dockerfile` builds the client, then copies `server/`, `scripts/`,
`src/lib/`, and `dist/` into a runtime image that just runs `node
server/index.ts` — no compile step for the server (see its own comment on
why). `compose.yml` wires that image into a Traefik edge network, with the
SQLite database bind-mounted at `./data` so it's covered by hub's nightly
backup. `PUBLIC_URL` must be the real HTTPS origin in production — it's the
MCP OAuth issuer/resource URL (RFC 8707), and the authorization router
rejects a non-HTTPS, non-localhost issuer outright.

## Project layout

```
src/
  components/         React UI: score viewer, practice session, piece library, history...
  lib/
    musicxml/          Parsing MusicXML/.mxl, building the expected note timeline
    scoring/            NoteMatcher (Metronome mode) and SequenceMatcher (Notes mode)
    clock/              Audio-clock/MIDI-clock correlation, the metronome scheduler
    midi/               Web MIDI access, MIDI event parsing, computer-keyboard fallback
    coach/              Turns attempt history into "what to practice next"
    streak.ts            Practice-streak calculation, shared with the MCP `streak` tool
    db/                 The `*Repo.ts` files (thin fetch wrappers over /api now — see
                         server/) and the IndexedDB outbox itself (db.ts)
    api/                 The fetch wrapper every repo goes through (client.ts)
server/
  routes/               REST API (pieces, sections, attempts)
  oauth/                 The MCP endpoint's own OAuth 2.1 authorization server
  auth/                  Username+password login, session cookies
  queries.ts              Shared SQLite data-access layer, used by both routes/ and mcp.ts
scripts/
  createUser.ts           Command-line alternative to /signup for creating a login
```

Everything under `src/lib/` is plain TypeScript with co-located `*.test.ts`
files and no React dependency — the scoring/timeline/coaching logic is
tested independently of the UI that drives it, and several of these modules
(`coach/`, `streak.ts`, `db/db.ts`'s types) are reused directly by the
server, unbundled — see CLAUDE.md's Server section.

See `docs/coaching-gaps.md` for a written-up assessment of where the
scoring pipeline still falls short pedagogically (e.g. it only ever
scores pitch and onset timing — no dynamics, articulation, or pedal).

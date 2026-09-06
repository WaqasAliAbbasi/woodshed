# Woodshed

A client-only React/TypeScript SPA — see `README.md` for what it does. No
backend, no API, no server-side state. Everything a user creates (uploaded
pieces, practice sections, attempt history) lives in the browser's
IndexedDB (`src/lib/db/db.ts`, via the `idb` wrapper). Keep that in mind
before reaching for a server-side solution to anything.

## Commands

```bash
npm run dev         # vite dev server, localhost only, plain HTTP
npm run dev:https   # also binds the LAN + self-signed cert — needed to test
                     # Web MIDI or PWA install from another device (e.g. an iPad)
npm test            # vitest run
npm run lint        # oxlint
npx tsc -b          # typecheck (part of `npm run build`)
npm run build       # tsc -b && vite build -> dist/
```

Test files are co-located as `*.test.ts`/`*.test.tsx` next to what they
cover. MusicXML fixtures live in `src/lib/musicxml/__fixtures__/`. DB tests
use `fake-indexeddb`.

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

## Things worth knowing before changing code

- **iOS/iPadOS has no Web MIDI support in any browser, Safari included.**
  `lib/platform.ts`'s `isIOS()` and the computer-keyboard fallback
  (`InputSourceSelector`) exist because of this, not as a nice-to-have —
  don't assume Web MIDI is always available.
- **The IndexedDB schema is real user data**, not a fixture — this app is
  live (see `compose.yml`) and stores pieces/sections/attempts entirely
  client-side with no server backup. A schema change needs a version bump
  and an `upgrade()` migration path in `db.ts`, not a breaking rewrite.
  Several fields (`Section.handFilter`, `Section.mode`,
  `Attempt.durationMs`) are optional specifically because older stored
  records predate them.
- **No responsive breakpoints existed before the iPad-landscape fix** — the
  layout (`App.css`) is a single fixed-width column by default. If you add
  UI, check it at both a phone-portrait width and a landscape-tablet width
  (≥860px), since the two can behave very differently once content wraps.
- Timing tolerances (`ON_TIME_MS`, `ACCEPT_MS` in `lib/scoring/matcher.ts`)
  are tuned for a forgiving practice tool, not a rhythm-game-tight
  competition — see the comments on those constants before tightening them
  back up.

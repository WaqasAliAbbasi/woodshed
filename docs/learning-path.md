# Learning path: build spec

Woodshed should guide a new piece the way practice already goes well for this
user: small chunk, Notes mode, Metronome mode, then join it to the ready chunk
before it. On top of that, a daily plan that spans every piece the last lesson
assigned. This file is the brief for building it. Everything a build session
needs is here or linked.

- **Design rationale, evidence and research:** [Woodshed Learning Path](https://claude.ai/artifact/PP4nYtzkeoEtzp8if2UcfV) (Claude Docs)
- **Screens:** [Woodshed Learning Path Screens](https://claude.ai/artifact/7YSRN8NJgvwp46ajB9i2DY) (Claude Design canvas). Read artboards with the Artifact tool (`read` with `path: "project/<Name>.dc.html"`). The mock data in them is illustrative.
- **Related issues:** #9, #10, #11, #12 and #13 are covered by this spec (link them from the PRs that land each piece). Fixing #33 (swing) and #34 (fermatas) is out of scope for this build.

## Principles

1. **One decision per screen.** One primary button; everything else is secondary or behind it. Readable from the piano bench: 20px body text, buttons at least 64px tall.
2. **Rules, not AI.** Every in-session decision is a pure, tested function of stored attempts. No model calls in the app.
3. **Never pile up guilt.** Plans are recomputed from current state each time; nothing is ever "overdue".
4. **Phone for planning, laptop for playing.** See [Devices](#devices).
5. **Keep what works.** The existing practice workspace stays as **Free practice**; the path is built on top of it, not instead of it.

## Decisions (settled; don't reopen without asking)

| Topic | Decision |
| --- | --- |
| Whole piece before every chunk is ready | **Hard lock.** The path's whole-piece step is disabled until it's unlocked. Free practice can still play anything. (The `JoinWarn` artboard is the rejected alternative; ignore it.) |
| Build order | Phase 1 core, then Phase 2 and 3 extras (below) |
| Chunk boundaries | Automatic in Phase 1; dragging boundaries is Phase 2 (`OverviewEditable` artboard) |
| Joining | Snowball: chunk 1+2, then 1–3, and so on. The last join is the whole piece |
| Pass marks | "Ready" reuses `classifyAccuracy` thresholds in `src/lib/coach/suggestNextStep.ts` (pitch ≥ 95%, rhythm ≥ 85%) |
| Teacher's verdict | A lesson marked "Finished" marks the piece done, whatever the path says |
| Existing history | Kept and shown as history. Not mapped onto chunks or rungs; each piece's path starts fresh |
| Exam | ABRSM Grade 1, date not set. Pieces: Remember Me, Berry's Smoothie, Melody in F, Fireworks Minuet |
| Lesson day | A user setting (this user: Saturday). Drives "lesson Sat 28 Nov" labels and lesson-week grouping |
| Session end | Unchanged: a session closes after `SESSION_GAP_MS` (20 min) without attempts. The session-end screen shows only if the user presses Finish |
| Live note colouring | Unchanged in Phase 1 (Notes mode colours live, Metronome mode at the end). Fading it is a Phase 3 experiment |

## Phases

**Phase 1: core (build this first)**

1. Chunking and repeat detection for a piece (automatic)
2. The per-chunk rungs, joins, guardrails and the hard-locked whole piece
3. Today's plan across pieces, with "Finish now" ending on a win
4. Multi-piece lesson log (Finished / Keep going + focus / New)
5. Collections: exam set and book, with folder import
6. Device rules: phone-friendly planning screens, and the bigger-screen page for practice screens

**Phase 1 polish (after Phase 1 landed):** make every Phase 1 screen match its artboard, and bring the Sessions and Stats redesign forward so no old UI is left in the main tabs. See [Look and feel](#look-and-feel). No rule or behaviour changes.

**Phase 2:** hear it first (#11), listen back, editable chunk boundaries, an exam date that spreads the plan.

**Phase 3:** left-hand-pattern rung, metronome-weaning rung, pedal (MIDI CC64), feedback-fading experiment, sending a run-through to the teacher, microphone recording.

**Out:** YouTube links, AI in the app, #33 and #34 (separate fixes; they should land before swing or fermata pieces enter the path).

## The path inside one piece

### Chunks

- Cut on a 4-bar grid starting at the first full measure. A pickup bar joins chunk 1.
- Move a boundary by at most 1 bar to land on phrase evidence: a slur ending, a rest at the end of a bar in either hand, a fermata, or a double barline.
- Chunks are 2–6 bars. A final chunk shorter than 2 bars merges into the one before it.
- **Repeats:** a chunk whose notes are identical in both hands (pitch and duration) to an earlier chunk gets `repeat_of`. It shows "same as N", its status mirrors its source, and it still takes part in joins.
- The overview shows "N bars, M new" (M = bars not identical to an earlier bar) and "K chunks to learn".
- Survey of the user's 70 scores: no repeat barlines or D.C./D.S. anywhere, so walking measures in order is enough. 41% of measures exactly repeat an earlier one.

### Rungs

Each chunk climbs these rungs in order. An attempt counts only if it isn't aborted, unless a rule below says otherwise.

| Rung | Mode and settings | Passed when | Stuck after 3 tries without passing |
| --- | --- | --- | --- |
| 1. Notes, one hand (optional; offered, not required) | Notes mode, one hand | 2 wrong notes or fewer | Offer half the chunk |
| 2. Notes, both hands | Notes mode, both hands | 2 wrong notes or fewer | Offer rung 1 for the weaker hand |
| 3. Metronome | Metronome mode at the start tempo | Ready twice in a row | Offer 10% slower |
| 4. Build tempo | Metronome mode, tempo set per try (below) | Ready twice at the target tempo | Stay at the last passed tempo; end today there |
| Ready | | Rung 4 passed (rung 3 if start tempo = target) | |

**Tempo**
- Target: `pieces.target_tempo_bpm`, else the score's marked tempo, else 80.
- Start: the tempo the user last passed rung 3 at on any piece in the past 30 days, capped at the target. With no such pass: 70% of the target. Always round to the metronome dial (`buildExpectedTimeline.ts`).
- Build tempo, per try: after a pass at T, try about 10% higher (dial-rounded, capped at the target); after a miss, try one dial step below the last passed tempo. The screen says why ("A little under, after a miss at 69").

### Joins and the whole piece

- When chunk k+1 is ready and chunks 1..k are joined (or k = 1 and chunk 1 is ready), the next step is **Join 1–(k+1)**: Metronome mode at the target tempo. It passes on one ready attempt.
- Three join misses offer a **seam drill**: the last bar of chunk k plus the first bar of chunk k+1, ready twice. Then the join again.
- The final join is the whole piece. It is **hard-locked** until every chunk is ready and the previous join has passed. The locked card says what's left ("2 to go: chunks 4 and 5"), and links to Free practice.
- The whole-piece step is a **run-through**: no abort button, and the full attempt is always recorded.
- A passed join is a milestone. It gets the bigger celebration card (`JoinLock` artboard), not a toast.

### Guardrails (nudges)

Each nudge shows at most once per rung per session, as one choice card (`Nudge` artboard), never as a page of stats.

- **Quick stops:** 2 aborts in a row, each under 15 seconds. Offer "Shorter: measures a–b only" (the first half of the chunk) or "Slower: 10% under this try".
- **Rhythm, not notes:** across 3 attempts, pitch ≥ 95% but rhythm < 70%. Say it's a counting problem and suggest counting aloud at the same tempo. A "tap the rhythm" mode is out of scope; drop that option from the artboard.
- Leave Notes mode at 2 wrong notes or fewer; never require a perfect pass.

## Across pieces

### Today's plan

`buildDailyPlan(state, today, budgetMinutes)` is a pure function, recomputed whenever the plan is opened.

- **Active pieces:** those whose latest lesson outcome is Keep going or New. Ready pieces in the exam collection get one short review a week.
- **Budget:** 20 minutes by default, with a 10 / 20 / 30 choice on the plan screen.
- **Order:**
  1. Warm-up (about 2 min): review the most recently readied chunk or join.
  2. Work blocks (about 5 min each), round-robin across active pieces. The piece with a teacher focus goes first. Each block is that piece's next step: the lowest unpassed rung of its earliest unready chunk, or its next join.
  3. Each piece gets at most 2 blocks. Stop adding blocks with 2 minutes of budget left.
  4. End on a win (1–2 min): one run of something already ready, preferring the focus piece.
- Each step shows a one-line reason ("Your teacher's focus this week", "New from the lesson", "Exam piece · rhythm was 62%").
- **Finish now**, on every practice screen, jumps straight to the win.
- Practising any piece directly counts. Passing a rung there updates the next plan. Free practice attempts are recorded but don't move a path.

### Logging a lesson

One lesson entry has a date, minutes, one note, and a row for each piece covered:
- **Finished:** marks the piece done, including in its book.
- **Keep going:** with an optional focus line, shown on the plan and on that piece's first block.
- **New:** chunks the piece and adds it to the plan from the next day.

Old manual sessions labelled "Lesson" still display as lessons.

### Collections

- A collection is a book (ordered by page) or an exam set (optional date). A piece can belong to one or more.
- **Import a folder:** in the Library, pick a folder (`<input webkitdirectory>`). For each subfolder named `NNN - Title`, add its `.musicxml` or `.mxl` with page NNN. If a `metadata.json` exists, set the target tempo from `bpms[0]`.
- **Book progress:** one mark per piece in page order (done / current / not yet), and the next pieces up with their "bars new" and chunk counts (`Library` artboard).
- The Library groups by collection, and can also show all pieces or recent pieces.
- **Don't commit the user's scores.** The Alfred files are copyrighted. Tests use fixtures in `src/lib/musicxml/__fixtures__/` or small hand-written MusicXML.

## Devices

- **Phone-friendly** (fluid, single column below about 700px): Library, Today's plan, Log lesson, the session-end note, Sessions and Stats.
- **Laptop or tablet only:** piece overview, rung, result, nudge, join and whole-piece screens, and Free practice. Below 700px wide they're replaced by the **bigger-screen page** (`PhoneNeedsBigger` artboard). It names the piece and chunk, explains that iPhone browsers can't use MIDI, and offers Today's plan, Log lesson, and copying the link.
- Check every new screen at 390px and at 860px or wider (CLAUDE.md).

## Look and feel

The artboards are the visual spec, not just a reference. Mock data in them is illustrative; layout, type sizes, spacing, colours and hierarchy are not. When the code and an artboard differ visually, the artboard wins, unless matching it would change a rule in this file.

**Tokens:** use the existing ones in `src/index.css`, including dark mode. Don't invent new colours.
- Headings: Piazzolla. Body text: Work Sans.
- Pine is the primary button colour.
- Amber means "current" or "selected", nothing else. Green means ready, nothing else.
- Neutral warm grey means attempted but not yet ready.

**One app shell on every page:**
- The Woodshed mark on the left. Tabs Today, Library, Sessions and Stats; the active tab has a filled background.
- Practice screens replace the tabs with a slim bar: back to Today, piece and chunk, Finish now, Free practice (`Rung` artboard).
- Log out, MCP and Export key move into a small account menu at the right of the header. There's no footer.
- One content width everywhere: a `max-width` of about 1200px, with `clamp(16px, 4vw, 40px)` side padding. No page may be a narrower column than the others.

**Sizes, readable from the piano bench:**
- Body text 18–20px; h1 `clamp(36px, 7vw, 52px)`.
- Primary buttons 64–96px tall, one per screen.
- Cards have 12–14px radius and 1px borders, as in the artboards.

**Practice step** (`Rung`, `AfterAttempt`, `Nudge`, `JoinLock`, `SessionEnd` artboards):
- **Score first.** Show only the current chunk's (or join's) measures, zoomed to fill the content width, directly under the rung pills and above everything else.
- No OSMD zoom buttons on path screens; Free practice keeps them.
- The tempo panel and Play sit side by side below the score, as in `Rung`. Notes-mode rungs show "No click · take your time" in that panel's place, at the same size.
- The result after an attempt is its own state, laid out like `AfterAttempt`, not a toast or an inline line. Nudges are laid out like `Nudge`. Join milestones like `JoinLock`.

**Sessions and Stats** (`Sessions` and `Stats` artboards, plus `PhoneSessions` and `PhoneStats`):
- **Sessions:** grouped into the week before each lesson, with 7 day-dots and a summary per week. Lesson cards are visually distinct from practice cards. A callout appears when the only practice was on lesson day, and gaps of 2 or more empty weeks collapse into one line. It filters by collection, and has Log practice and Log lesson buttons. "This week" sits at the top with "Start today's plan".
- **Stats:** the headline chart shows practice days per lesson week, with a dashed 4-day line, and the title states the finding ("4 or more practice days in N of the last M weeks"). Below it: total tiles, then minutes by piece grouped by collection. It filters by collection. The old practice calendar is removed.

**Visual acceptance.** For every artboard named above, plus `Main`, `OverviewRepeats`, `TodayPlan`, `Library`, `LogLesson` and `PhoneNeedsBigger`:
1. Run the app with realistic data. Several pieces in an exam collection and a book, a few lessons, some passed rungs. A local seed script is fine; don't commit the user's scores.
2. Screenshot it at 1280×860 and 390×844.
3. Compare against the artboard. Open the canvas in the built-in browser if you can, or read the artboard source with the Artifact tool. Fix differences in layout, size and hierarchy until a side-by-side would read as the same design.

**Local dev gotcha:** in a worktree under `.claude/`, `/login` returns 404. Express's `sendFile` refuses paths containing a dot-directory. Fix it with `{ dotfiles: 'allow' }` on the `login.html` and `signup.html` `sendFile` calls in `server/index.ts`, scoped to those two files.

## Data (expand-only; see CLAUDE.md on `schema.sql`)

Suggested shape; the build session may adjust it, but must keep every query scoped by `userId`.

- `chunks`: id, user_id, piece_id, idx, start_measure, end_measure, repeat_of_chunk_id, created_at.
- `sections` gains `chunk_id` and `rung`, nullable, via `ADDED_COLUMNS`. The path creates ordinary sections ("Chunk 3 · Notes", "Join 1–3") and attempts keep pointing at sections. History, the MCP tools and `attemptsRepo`'s outbox then keep working unchanged.
- Rung progress is **derived** from those attempts by a pure function (`src/lib/path/`). No stored rung state.
- `pieces` gains `finished_at`, nullable.
- `collections`: id, user_id, name, kind (`book` | `exam` | `other`), exam_date, created_at. `collection_pieces`: collection_id, piece_id, position, page.
- `lesson_pieces`: session_id (a `practice_sessions` row), piece_id, outcome (`finished` | `continue` | `new`), focus.
- `users` (or a settings table) gains `lesson_weekday`, nullable.

Pure functions to write first, each with co-located tests:
- `chunkPiece`
- `findRepeats`
- `rungProgress`
- `nextStep`
- `startTempo` / `nextTryTempo`
- `nudgeFor`
- `buildDailyPlan`

## Phase 1 is done when

- [ ] Opening Divertimento in D (17 bars, almost no repetition) shows 2–6-bar chunks covering every bar, and says 16 of 17 bars are new.
- [ ] Opening You're In My Heart (32 bars) on the plain 4-bar grid marks chunks 3, 6 and 7 as "same as 1, 4, 5".
- [ ] A chunk goes Notes → Metronome → Build tempo → Ready using only the primary button. Tempo changes per try follow the rules.
- [ ] Two quick aborts show the quick-stops nudge; the rhythm rule shows the counting nudge.
- [ ] The whole piece stays locked until every chunk is ready and joined, and then runs as a run-through.
- [ ] Logging a lesson with three pieces (Finished, Keep going with a focus, New) produces a plan across the remaining pieces that ends on a win.
- [ ] Importing the Book 2 folder creates a page-ordered book of 66 pieces.
- [ ] At 390px, practice screens show the bigger-screen page; the Library, plan and lesson log are usable.
- [ ] `npm test`, `npm run lint` and `npx tsc -b` pass. Old pieces and history still load. The MCP tools still answer.
- [ ] The user tries it at the piano on one real piece before Phase 2 starts.

## Phase 1 polish is done when

- [ ] Every screen listed under [Look and feel](#look-and-feel) passes its side-by-side check at 1280×860 and 390×844.
- [ ] Today, Library, Sessions and Stats share one header and one content width. No old views remain in the main tabs.
- [ ] The practice step shows the chunk's measures, zoomed, as the first thing under the rung pills.
- [ ] Log out, MCP and Export key are in the account menu; there's no footer.
- [ ] Sessions and Stats match their artboards, including at phone width. The old practice calendar is gone.
- [ ] `/login` works when running from a worktree under `.claude/`.
- [ ] No change to any rule, query result or stored data shape. `npm test`, `npm run lint` and `npx tsc -b` pass.

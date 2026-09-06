# Woodshed

A browser-based practice companion for piano/keyboard: upload a MusicXML
score, play along on a real MIDI keyboard, and get per-note pitch and timing
feedback right on the sheet music. Everything runs client-side — there's no
account, no server, and no database beyond what the browser stores locally.

Live at [woodshed.waqasali.dev](https://woodshed.waqasali.dev).

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

## Getting started

```bash
npm install
npm run dev
```

Web MIDI requires a "secure context" (HTTPS, or `localhost`). Plain `npm run
dev` is fine on the machine you're developing on. To test from another
device on your network (e.g. an iPad with a MIDI keyboard), use:

```bash
npm run dev:https
```

This also binds to your LAN address and serves a self-signed cert.

## Testing and linting

```bash
npm test        # vitest
npm run lint    # oxlint
npx tsc -b      # typecheck (also runs as part of `npm run build`)
```

## Building and deploying

```bash
npm run build   # -> dist/, a static site
```

There's no backend: `dist/` is served as-is. The `Dockerfile` builds it and
serves it from Caddy (see `Caddyfile`); `compose.yml` wires that image into a
Traefik edge network for deployment.

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
    db/                 IndexedDB persistence (pieces, sections, attempts) via idb
```

Everything under `lib/` is plain TypeScript with co-located `*.test.ts`
files and no React dependency — the scoring/timeline/coaching logic is
tested independently of the UI that drives it.

See `docs/coaching-gaps.md` for a written-up assessment of where the
scoring pipeline still falls short pedagogically (e.g. it only ever
scores pitch and onset timing — no dynamics, articulation, or pedal).

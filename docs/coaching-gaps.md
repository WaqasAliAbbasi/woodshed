# Coaching gaps (found reviewing Alfred All-in-One Book 2)

Snapshot from evaluating the app's practice loop against all 66 pieces in the
"Alfred All-in-One Book 2" collection (folk songs/marches/dances, elementary–intermediate
level). File parsing/rendering was already confirmed fine for this set — these are
gaps in whether the practice/scoring pipeline actually *teaches* the pieces well.

## What's actually built today

Upload MusicXML → OSMD renders it → user manually clicks a measure range → picks a
tempo → count-in → play along on MIDI → per-note pitch/onset-timing scoring
(`NoteMatcher` in `src/lib/scoring/matcher.ts`) → flat history log table. There is no
AI/adaptive coaching layer yet — `HistoryView` just lists past attempts; nothing reads
that history to suggest a next step. When asking "would our app teach piece X well,"
the bottleneck today is almost always this missing coaching layer, not piece content —
every piece gets the same generic manual-drill treatment regardless of its musical
demands.

## Concrete gaps

1. **Metronome/count-in miscounts non-quarter-beat meters.** `getBeatsPerMeasure`
   (`src/lib/musicxml/buildExpectedTimeline.ts`) returns the time signature's raw
   numerator as "beats per measure," assuming a quarter-note beat throughout. For any
   meter with beat-type ≠ 4 (6/8 etc.) this is off by a factor of `beat-type / 4`, so
   count-in length and the beat-indicator dots run ~2x too long for 6/8 pieces.
   ~14% of this book (9 of 64 scanned pieces) is wholly or partly in 6/8 — La Raspa,
   Tarantella, Scherzo, Night Song, The Magic Piper, When Johnny Comes Marching Home,
   For He's a Jolly Good Fellow, and Battle Hymn of the Republic (mid-piece) — exactly
   the pieces meant to teach a compound-meter lilt. Note-matching/scoring itself is
   unaffected (it works in absolute seconds via `RealValue`, meter-independent) — only
   the metronome/UI beat count is wrong.

2. **No piece-derived tempo default.** Practice tempo always starts at a hardcoded
   80 BPM (`PracticeSession.tsx`), regardless of piece. Nothing reads the MusicXML's
   `<sound tempo>` or a sidecar `metadata.json`'s `tempo`/`tempoMarking`
   (e.g. "Moderato", 100 BPM for "Down in the Valley"). A waltz and a march both start
   practice at the same generic tempo.

3. **Composer/title metadata mostly discarded on import.** `PieceLibrary.tsx`'s title
   regex only matches `<work-title>`, but these exports (this whole book
   included) use `<movement-title>` instead — it silently falls back to the filename
   (looks fine here only because filenames happen to match song titles). `composer` is
   never extracted from `<creator>` at all, so every imported piece has a blank
   composer field even though the DB schema (`src/lib/db/db.ts`) has room for it.

4. **No hands-separate practice mode.** Several pieces in this set report 3–4
   simultaneous `<voice>` values per staff (Battle Hymn, Danny Boy, Night Song, Dark
   Eyes, Musetta's Waltz theme, Loch Lomond, The Riddle) — chordal/inner-voice texture
   a beginner would typically want to isolate hand-by-hand. The app only supports
   playing the full selected range hands-together.

5. **Scoring is pitch + onset-timing only.** No dynamics, articulation, note
   duration/release, or pedal feedback. For lyrical/expressive pieces in this set
   (Danny Boy, Sakura, Loch Lomond, Aria from The Marriage of Figaro) where
   phrasing/tone *is* the point, the app can score "right notes in time" while being
   blind to the actual skill the piece is teaching.

6. **Dense tuplet passages risk ambiguous matching — untested.** `NoteMatcher`'s
   acceptance window is ±180ms (`ACCEPT_MS` in `src/lib/scoring/matcher.ts`). Pieces
   with heavy triplet/16th-note-triplet writing (Olympic Procession: 42 tuplets, Space
   Shuttle Blues: 24, Hungarian Rhapsody No. 2) could pack multiple expected onsets
   within that window at performance tempo, risking a note being matched to the wrong
   nearby event. Worth a live spot-check at target tempo.

## Upside

None of the 66 pieces use repeat barlines, voltas, D.C./D.S./Fine, or grace notes —
this collection's arrangements are fully written out. So the app's linear (no
repeat-jump) measure walk — a known simplification — isn't a problem for this
collection, and a future "play the whole piece straight through" mode would work
correctly here without needing repeat-structure support first.

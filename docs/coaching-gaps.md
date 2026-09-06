# Coaching gaps (found reviewing Alfred All-in-One Book 2)

Snapshot from evaluating the app's practice loop against all 66 pieces in the
"Alfred All-in-One Book 2" collection (folk songs/marches/dances, elementary–intermediate
level). File parsing/rendering was already confirmed fine for this set — these are
gaps in whether the practice/scoring pipeline actually *teaches* the pieces well.

## What's actually built today

Upload MusicXML → OSMD renders it → user manually clicks a measure range → picks a
tempo (defaulting to the piece's own marked tempo, see `getDefaultTempoBpm`) → count-in
→ play along on MIDI, hands-together or isolated to one hand (`HandFilterControl`) →
per-note pitch/onset-timing scoring (`NoteMatcher` in `src/lib/scoring/matcher.ts`) →
history log with a minimal rule-based "what to practice next" suggestion
(`suggestNextStep`, driven off the most recent attempt's accuracy). When asking "would
our app teach piece X well," the remaining gaps below are mostly about how much of a
performance the scoring pipeline actually listens to, not the coaching/UI loop around
it.

## Concrete gaps

1. **Scoring is pitch + onset-timing only.** No dynamics, articulation, note
   duration/release, or pedal feedback. For lyrical/expressive pieces in this set
   (Danny Boy, Sakura, Loch Lomond, Aria from The Marriage of Figaro) where
   phrasing/tone *is* the point, the app can score "right notes in time" while being
   blind to the actual skill the piece is teaching.

## Upside

None of the 66 pieces use repeat barlines, voltas, D.C./D.S./Fine, or grace notes —
this collection's arrangements are fully written out. So the app's linear (no
repeat-jump) measure walk — a known simplification — isn't a problem for this
collection, and a future "play the whole piece straight through" mode would work
correctly here without needing repeat-structure support first.

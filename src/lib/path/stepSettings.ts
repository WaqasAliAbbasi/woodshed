import type { HandFilter } from '../musicxml/buildExpectedTimeline.ts'
import type { MeasureRange } from '../musicxml/types.ts'
import type { PracticeMode } from '../scoring/types.ts'
import { NOTES_PASS_MAX_WRONG } from './rungProgress.ts'
import type { PiecePath } from './nextStep.ts'
import { isReadyAttempt } from './rungProgress.ts'
import { nextTryTempo, startTempo, type Rung3Pass, type TempoChoice } from './tempo.ts'
import type { PathAttempt, PathRung } from './types.ts'

/**
 * One concrete thing to play on the path: which section it is (chunk,
 * rung, range, hand, mode) and the tempo for this try. A step screen asks
 * for one of these, plays it, and asks again — every value comes from the
 * stored attempts, so nothing about "where you are" needs saving.
 */
export interface StepSettings {
  rung: PathRung
  chunkId: string
  range: MeasureRange
  mode: PracticeMode
  handFilter: HandFilter
  tempo: TempoChoice
  /** The whole piece: no stop button, and the attempt is always recorded in full. */
  runThrough: boolean
  /** The section label this is stored under, e.g. "Chunk 3 · Notes". */
  label: string
  /** One line saying what passes this step. */
  goal: string
  /** Rung 4 is stuck: stay at the last passed tempo and call it a day on this chunk. */
  endToday?: boolean
}

/**
 * `slowerBpm` is a "Slower" offer taken (from a nudge, or a stuck rung 3):
 * this try only, at that tempo. It counts toward the rung like any other
 * try, so the next try's tempo follows on from it.
 */
export type StepRequest =
  | { kind: 'chunk'; idx: number; rung: 'notes' | 'metronome' | 'tempo'; slowerBpm?: number }
  | { kind: 'notes-hand'; idx: number; hand: 'left' | 'right' }
  | { kind: 'join'; k: number; slowerBpm?: number }
  | { kind: 'seam'; k: number; slowerBpm?: number }
  | { kind: 'review'; item: { kind: 'chunk'; idx: number } | { kind: 'join'; k: number } }
  | { kind: 'drill'; idx: number; range: MeasureRange; mode: PracticeMode; handFilter: HandFilter; tempoBpm: number }

export interface StepContext {
  path: PiecePath
  /** The piece's attempts, chronological or not. */
  attempts: PathAttempt[]
  /** Rung-3 passes across the whole library — where a fresh chunk's metronome tempo starts. */
  rung3Passes: Rung3Pass[]
  targetTempoBpm: number
  now: number
  /** Which sections are which — attempts are matched to rungs through these. */
  sectionRung: Map<string, { chunkId?: string; rung?: PathRung }>
}

const HAND_NAME: Record<'left' | 'right', string> = { left: 'Left hand', right: 'Right hand' }

function attemptsAt(ctx: StepContext, chunkId: string, rung: PathRung): PathAttempt[] {
  return ctx.attempts
    .filter((a) => {
      const s = ctx.sectionRung.get(a.sectionId)
      return s?.chunkId === chunkId && s.rung === rung
    })
    .sort((a, b) => a.timestamp - b.timestamp)
}

function fixed(bpm: number, reason: string): TempoChoice {
  return { bpm, reason }
}

const SLOWER_REASON = 'A little slower, this try'

/** The first half of a range (at least one bar) — "Shorter: measures a–b only". */
export function firstHalf(range: MeasureRange): MeasureRange {
  const bars = range.endMeasure - range.startMeasure + 1
  return { startMeasure: range.startMeasure, endMeasure: range.startMeasure + Math.max(1, Math.floor(bars / 2)) - 1 }
}

/**
 * Which hand fumbled more in Notes mode. A wrong note has no expected note
 * to borrow a hand from (see NoteResult.hand), so this goes by where it was
 * played: below middle C counts as the left hand. Right hand on a tie.
 */
export function weakerHand(attempts: PathAttempt[]): 'left' | 'right' {
  let left = 0
  let right = 0
  for (const a of attempts) {
    for (const r of a.noteResults ?? []) {
      if (r.classification !== 'extra' || r.actualMidi === undefined) continue
      if (r.actualMidi < 60) left++
      else right++
    }
  }
  return left > right ? 'left' : 'right'
}

export function settingsFor(request: StepRequest, ctx: StepContext): StepSettings {
  const { path, targetTempoBpm: target } = ctx
  const chunkCount = path.chunks.length

  switch (request.kind) {
    case 'chunk': {
      const state = path.chunks[request.idx]
      const { chunk } = state
      const range = { startMeasure: chunk.startMeasure, endMeasure: chunk.endMeasure }
      const base = { chunkId: chunk.id, range, runThrough: false, handFilter: 'both' as const }
      const name = `Chunk ${state.number}`
      if (request.rung === 'notes') {
        return {
          ...base,
          rung: 'notes',
          mode: 'notes',
          tempo: fixed(target, 'No metronome: take your time'),
          label: `${name} · Notes`,
          goal: `${NOTES_PASS_MAX_WRONG} wrong notes or fewer`,
        }
      }
      if (request.rung === 'metronome') {
        const tries = attemptsAt(ctx, chunk.id, 'metronome').filter((a) => !a.aborted)
        const last = tries.at(-1)
        const tempo = request.slowerBpm
          ? fixed(request.slowerBpm, SLOWER_REASON)
          : last
          ? fixed(last.tempoBpm, isReadyAttempt(last) ? 'Same again: twice in a row passes' : `Same tempo as your last try`)
          : startTempo(ctx.rung3Passes, target, ctx.now)
        return { ...base, rung: 'metronome', mode: 'metronome', tempo, label: `${name} · Metronome`, goal: `Ready twice in a row at ${tempo.bpm} bpm` }
      }
      const progress = state.progress
      const rung3PassTempo = progress.rung3.passTempo ?? target
      const goal = `Ready at ${target} bpm, twice`
      if (progress.rung4.stuck && progress.rung4.lastPassedTempo !== undefined) {
        const bpm = progress.rung4.lastPassedTempo
        return {
          ...base,
          rung: 'tempo',
          mode: 'metronome',
          tempo: fixed(bpm, `Stay at ${bpm} today: it's solid there`),
          label: `${name} · Build tempo`,
          goal,
          endToday: true,
        }
      }
      const tries = attemptsAt(ctx, chunk.id, 'tempo')
        .filter((a) => !a.aborted && a.aggregate.expected > 0)
        .map((a) => ({ tempoBpm: a.tempoBpm, passed: isReadyAttempt(a) }))
      return {
        ...base,
        rung: 'tempo',
        mode: 'metronome',
        tempo: request.slowerBpm ? fixed(request.slowerBpm, SLOWER_REASON) : nextTryTempo(tries, rung3PassTempo, target),
        label: `${name} · Build tempo`,
        goal,
      }
    }

    case 'notes-hand': {
      const state = path.chunks[request.idx]
      return {
        rung: 'notes-hand',
        chunkId: state.chunk.id,
        range: { startMeasure: state.chunk.startMeasure, endMeasure: state.chunk.endMeasure },
        mode: 'notes',
        handFilter: request.hand,
        tempo: fixed(target, 'No metronome: take your time'),
        runThrough: false,
        label: `Chunk ${state.number} · Notes, ${HAND_NAME[request.hand].toLowerCase()}`,
        goal: `${HAND_NAME[request.hand]} alone, ${NOTES_PASS_MAX_WRONG} wrong notes or fewer`,
      }
    }

    case 'join': {
      const join = path.joins.find((j) => j.k === request.k)!
      return {
        rung: 'join',
        chunkId: join.chunkId,
        range: { startMeasure: join.startMeasure, endMeasure: join.endMeasure },
        mode: 'metronome',
        handFilter: 'both',
        tempo: request.slowerBpm ? fixed(request.slowerBpm, `${SLOWER_REASON}: a join passes at ${target}`) : fixed(target, 'Your target'),
        runThrough: join.whole,
        label: join.whole ? 'Whole piece' : `Join 1–${join.k}`,
        goal: join.whole ? `One ready run-through at ${target} bpm` : `One ready run at ${target} bpm`,
      }
    }

    case 'seam': {
      const join = path.joins.find((j) => j.k === request.k)!
      return {
        rung: 'seam',
        chunkId: join.chunkId,
        range: { startMeasure: join.seam.startMeasure, endMeasure: join.seam.endMeasure },
        mode: 'metronome',
        handFilter: 'both',
        tempo: request.slowerBpm ? fixed(request.slowerBpm, SLOWER_REASON) : fixed(target, 'Your target'),
        runThrough: false,
        label: `Seam ${join.k - 1}–${join.k}`,
        goal: `Ready twice at ${target} bpm, then the join again`,
      }
    }

    case 'review': {
      const { item } = request
      if (item.kind === 'chunk') {
        const state = path.chunks[item.idx]
        return {
          rung: 'review',
          chunkId: state.chunk.id,
          range: { startMeasure: state.chunk.startMeasure, endMeasure: state.chunk.endMeasure },
          mode: 'metronome',
          handFilter: 'both',
          tempo: fixed(target, 'One run at your target'),
          runThrough: false,
          label: `Chunk ${state.number} · Review`,
          goal: 'One run, for the feel of it',
        }
      }
      const join = path.joins.find((j) => j.k === item.k)!
      return {
        rung: 'review',
        chunkId: join.chunkId,
        range: { startMeasure: join.startMeasure, endMeasure: join.endMeasure },
        mode: 'metronome',
        handFilter: 'both',
        tempo: fixed(target, 'One run at your target'),
        runThrough: join.whole,
        label: `${join.k === chunkCount ? 'Whole piece' : `Join 1–${join.k}`} · Review`,
        goal: 'One run, for the feel of it',
      }
    }

    case 'drill': {
      const state = path.chunks[request.idx]
      const { range } = request
      return {
        rung: 'drill',
        chunkId: state.chunk.id,
        range,
        mode: request.mode,
        handFilter: request.handFilter,
        tempo: fixed(request.tempoBpm, request.mode === 'notes' ? 'No metronome: take your time' : 'A little slower, same chunk'),
        runThrough: false,
        label: `Chunk ${state.number} · m. ${range.startMeasure}–${range.endMeasure}${request.handFilter === 'both' ? '' : `, ${request.handFilter} hand`}${request.mode === 'notes' ? ' (Notes)' : ''}`,
        goal: 'Clean once, then back to the whole chunk',
      }
    }
  }
}

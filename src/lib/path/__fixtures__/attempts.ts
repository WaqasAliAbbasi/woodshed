import type { Section } from '../../db/db'
import type { AttemptAggregate } from '../../scoring/types'
import type { Chunk, PathAttempt, PathRung } from '../types'

let counter = 0

/** A clean, ready Metronome-mode result unless overridden. */
export function aggregate(overrides: Partial<AttemptAggregate> = {}): AttemptAggregate {
  const expected = overrides.expected ?? 20
  return {
    expected,
    correct: expected,
    missed: 0,
    extra: 0,
    onTime: expected,
    early: 0,
    late: 0,
    pitchAccuracy: 1,
    timingAccuracy: 1,
    timingAccuracyOfCorrect: 1,
    ...overrides,
  }
}

export const READY = aggregate()
/** Right notes, sloppy rhythm: not ready. */
export const MISS = aggregate({ timingAccuracy: 0.6, timingAccuracyOfCorrect: 0.6, onTime: 12, late: 8 })
export const notes = (wrong: number) => aggregate({ extra: wrong })

export function attempt(
  sectionId: string,
  timestamp: number,
  agg: AttemptAggregate,
  options: { tempoBpm?: number; aborted?: boolean; durationMs?: number; pieceId?: string } = {},
): PathAttempt {
  counter++
  return {
    id: `a${counter}`,
    sectionId,
    pieceId: options.pieceId ?? 'p1',
    tempoBpm: options.tempoBpm ?? 80,
    timestamp,
    aborted: options.aborted ?? false,
    durationMs: options.durationMs ?? 20_000,
    aggregate: agg,
  }
}

export function chunk(idx: number, startMeasure: number, endMeasure: number, repeatOfChunkId?: string): Chunk {
  return { id: `c${idx}`, pieceId: 'p1', idx, startMeasure, endMeasure, repeatOfChunkId, createdAt: 0 }
}

export function section(id: string, chunkId: string, rung: PathRung, range: [number, number], handFilter?: Section['handFilter']): Section {
  return {
    id,
    pieceId: 'p1',
    label: id,
    startMeasure: range[0],
    endMeasure: range[1],
    defaultTempoBpm: 80,
    createdAt: 0,
    chunkId,
    rung,
    handFilter,
    mode: rung === 'notes' || rung === 'notes-hand' ? 'notes' : 'metronome',
  }
}

/** A fixed "now" mid-day, so tries an hour apart all fall on the same local day. */
export const NOW = new Date(2026, 10, 22, 15, 0, 0).getTime()
export const MIN = 60_000

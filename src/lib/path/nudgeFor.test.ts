import { describe, expect, it } from 'vitest'
import { aggregate, attempt, MIN, NOW, READY } from './__fixtures__/attempts'
import { nudgeFor, type NudgeInput } from './nudgeFor'

const t = (minutesAgo: number) => NOW - minutesAgo * MIN
const base: Omit<NudgeInput, 'attempts'> = {
  sessionStart: t(60),
  alreadyShown: false,
  mode: 'metronome',
  range: { startMeasure: 7, endMeasure: 9 },
  tempoBpm: 63,
}
const quickStop = (minutesAgo: number) => attempt('s', t(minutesAgo), aggregate({ correct: 2 }), { aborted: true, durationMs: 8000 })
const rhythmy = aggregate({ pitchAccuracy: 0.98, timingAccuracy: 0.62, timingAccuracyOfCorrect: 0.62, onTime: 12, late: 7, early: 1 })

describe('nudgeFor', () => {
  it('offers shorter or slower after two quick stops in a row', () => {
    expect(nudgeFor({ ...base, attempts: [quickStop(3), quickStop(2)] })).toEqual({
      kind: 'quick-stops',
      shorter: { startMeasure: 7, endMeasure: 7 },
      slowerBpm: 56,
    })
  })

  it('offers only shorter in Notes mode, which has no tempo to slow', () => {
    const nudge = nudgeFor({ ...base, mode: 'notes', range: { startMeasure: 1, endMeasure: 4 }, attempts: [quickStop(3), quickStop(2)] })
    expect(nudge).toEqual({ kind: 'quick-stops', shorter: { startMeasure: 1, endMeasure: 2 }, slowerBpm: undefined })
  })

  it("doesn't count a long abort, one quick stop, or stops from an earlier session", () => {
    const long = attempt('s', t(2), aggregate(), { aborted: true, durationMs: 40_000 })
    expect(nudgeFor({ ...base, attempts: [quickStop(3), long] })).toBeUndefined()
    expect(nudgeFor({ ...base, attempts: [attempt('s', t(4), READY), quickStop(2)] })).toBeUndefined()
    expect(nudgeFor({ ...base, attempts: [quickStop(90), quickStop(80)] })).toBeUndefined()
  })

  it('names a counting problem: right notes, rhythm under 70%, three tries running', () => {
    const attempts = [attempt('s', t(5), rhythmy), attempt('s', t(4), rhythmy), attempt('s', t(3), rhythmy)]
    expect(nudgeFor({ ...base, attempts })).toMatchObject({ kind: 'rhythm', pitch: 0.98, drift: 'late' })
    expect(nudgeFor({ ...base, attempts: attempts.slice(1) })).toBeUndefined()
    expect(nudgeFor({ ...base, mode: 'notes', attempts })).toBeUndefined()
  })

  it("isn't a counting problem when the notes are wrong too", () => {
    const sloppy = aggregate({ pitchAccuracy: 0.8, timingAccuracy: 0.5, timingAccuracyOfCorrect: 0.5 })
    expect(nudgeFor({ ...base, attempts: [attempt('s', t(5), sloppy), attempt('s', t(4), rhythmy), attempt('s', t(3), rhythmy)] })).toBeUndefined()
  })

  it('shows at most once per rung per session', () => {
    expect(nudgeFor({ ...base, alreadyShown: true, attempts: [quickStop(3), quickStop(2)] })).toBeUndefined()
  })
})

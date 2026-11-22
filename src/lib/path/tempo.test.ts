import { describe, expect, it } from 'vitest'
import { dialRound, dialStepBelow, nextTryTempo, startTempo, targetTempo, tenPercentSlower } from './tempo'

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY

describe('targetTempo', () => {
  it("prefers the piece's own target, then the score's marking, then 80", () => {
    expect(targetTempo(92, 120)).toBe(92)
    expect(targetTempo(undefined, 120)).toBe(120)
    expect(targetTempo(undefined, undefined)).toBe(80)
  })
})

describe('dial helpers', () => {
  it('round to the metronome dial and step along it', () => {
    expect(dialRound(53)).toBe(52)
    expect(dialRound(70)).toBe(69)
    expect(dialStepBelow(66)).toBe(63)
    expect(dialStepBelow(69)).toBe(66)
    expect(tenPercentSlower(63)).toBe(56)
    expect(tenPercentSlower(40)).toBe(36)
  })
})

describe('startTempo', () => {
  it('uses the last rung-3 pass on any piece in the past 30 days, capped at the target', () => {
    const passes = [
      { tempoBpm: 60, passedAt: NOW - 10 * DAY },
      { tempoBpm: 76, passedAt: NOW - 2 * DAY },
    ]
    expect(startTempo(passes, 100, NOW)).toEqual({ bpm: 76, reason: 'Your last metronome pass was at 76' })
    expect(startTempo(passes, 69, NOW).bpm).toBe(69)
  })

  it('falls back to 70% of the target, on the dial, with no recent pass', () => {
    const old = [{ tempoBpm: 100, passedAt: NOW - 31 * DAY }]
    expect(startTempo(old, 100, NOW)).toEqual({ bpm: 69, reason: 'About 70% of your target, 100' })
    expect(startTempo([], 120, NOW).bpm).toBe(84)
  })
})

describe('nextTryTempo', () => {
  it('goes about 10% up after a pass, capped at the target', () => {
    expect(nextTryTempo([], 60, 69)).toEqual({ bpm: 66, reason: 'About 10% up, after a pass at 60' })
    expect(nextTryTempo([{ tempoBpm: 66, passed: true }], 60, 69)).toEqual({ bpm: 69, reason: 'Your target, after a pass at 66' })
  })

  it('goes one dial step under the last passed tempo after a miss', () => {
    const tries = [
      { tempoBpm: 66, passed: true },
      { tempoBpm: 69, passed: false },
    ]
    expect(nextTryTempo(tries, 60, 69)).toEqual({ bpm: 63, reason: 'A little under, after a miss at 69' })
  })

  it('climbs back after recovering from a miss — the artboard sequence 60, 66, 69✗, 63, 69', () => {
    const tries = [
      { tempoBpm: 66, passed: true },
      { tempoBpm: 69, passed: false },
      { tempoBpm: 63, passed: true },
    ]
    expect(nextTryTempo(tries, 60, 69).bpm).toBe(69)
  })

  it('stays at the target once there', () => {
    expect(nextTryTempo([{ tempoBpm: 69, passed: true }], 60, 69)).toEqual({ bpm: 69, reason: 'Your target, again' })
  })

  it('always moves up after a pass, even where 10% rounds back to the same dial mark', () => {
    expect(nextTryTempo([{ tempoBpm: 40, passed: true }], 40, 100).bpm).toBe(44)
    expect(nextTryTempo([{ tempoBpm: 200, passed: true }], 40, 220).bpm).toBe(208)
  })
})

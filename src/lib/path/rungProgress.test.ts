import { describe, expect, it } from 'vitest'
import { attempt, MIN, MISS, notes, NOW, READY } from './__fixtures__/attempts'
import { rungProgress, startOfDay, type ChunkRungAttempts } from './rungProgress'

const empty = (): ChunkRungAttempts => ({ notesHand: [], notes: [], metronome: [], tempo: [] })
const t = (minutesAgo: number) => NOW - minutesAgo * MIN

describe('rungProgress', () => {
  it('starts at rung 2 (Notes, both hands) — rung 1 is optional', () => {
    const p = rungProgress(empty(), 80, NOW)
    expect(p.current).toBe('notes')
    expect(p.ready).toBe(false)
  })

  it('passes Notes with 2 wrong notes or fewer, never needing a perfect pass', () => {
    const a = empty()
    a.notes = [attempt('n', t(30), notes(3)), attempt('n', t(20), notes(2))]
    const p = rungProgress(a, 80, NOW)
    expect(p.rung2.passed).toBe(true)
    expect(p.current).toBe('metronome')
  })

  it('ignores aborted tries', () => {
    const a = empty()
    a.notes = [attempt('n', t(10), notes(0), { aborted: true })]
    expect(rungProgress(a, 80, NOW).rung2.passed).toBe(false)
  })

  it('passes Metronome on two ready tries in a row, not two scattered ones', () => {
    const a = empty()
    a.notes = [attempt('n', t(60), notes(0))]
    a.metronome = [attempt('m', t(50), READY), attempt('m', t(40), MISS), attempt('m', t(30), READY)]
    expect(rungProgress(a, 80, NOW).rung3.passed).toBe(false)
    a.metronome.push(attempt('m', t(20), READY, { tempoBpm: 56 }))
    const p = rungProgress(a, 80, NOW)
    expect(p.rung3.passed).toBe(true)
    expect(p.rung3.passTempo).toBe(56)
    expect(p.current).toBe('tempo')
  })

  it('passes Build tempo on two ready tries at the target, not necessarily in a row', () => {
    const a = empty()
    a.notes = [attempt('n', t(90), notes(0))]
    a.metronome = [attempt('m', t(80), READY, { tempoBpm: 60 }), attempt('m', t(70), READY, { tempoBpm: 60 })]
    a.tempo = [
      attempt('t', t(60), READY, { tempoBpm: 66 }),
      attempt('t', t(50), READY, { tempoBpm: 69 }),
      attempt('t', t(40), MISS, { tempoBpm: 69 }),
      attempt('t', t(30), READY, { tempoBpm: 63 }),
    ]
    let p = rungProgress(a, 69, NOW)
    expect(p.rung4.readyAtTarget).toBe(1)
    expect(p.ready).toBe(false)
    a.tempo.push(attempt('t', t(20), READY, { tempoBpm: 69 }))
    p = rungProgress(a, 69, NOW)
    expect(p.ready).toBe(true)
    expect(p.current).toBe('ready')
    expect(p.readyAt).toBe(t(20))
  })

  it('skips Build tempo when Metronome already passed at the target', () => {
    const a = empty()
    a.notes = [attempt('n', t(30), notes(1))]
    a.metronome = [attempt('m', t(20), READY, { tempoBpm: 69 }), attempt('m', t(10), READY, { tempoBpm: 69 })]
    const p = rungProgress(a, 69, NOW)
    expect(p.rung4.skipped).toBe(true)
    expect(p.ready).toBe(true)
  })

  it('treats a passed higher rung as passing the ones below it', () => {
    const a = empty()
    a.metronome = [attempt('m', t(20), READY), attempt('m', t(10), READY)]
    expect(rungProgress(a, 120, NOW).rung2.passed).toBe(true)
  })

  it('is stuck after 3 tries today without passing, but not on yesterday’s misses', () => {
    const a = empty()
    a.notes = [attempt('n', t(30), notes(4)), attempt('n', t(20), notes(5)), attempt('n', t(10), notes(3))]
    expect(rungProgress(a, 80, NOW).rung2.stuck).toBe(true)

    const yesterday = startOfDay(NOW) - 60 * MIN
    a.notes = [attempt('n', yesterday - 20 * MIN, notes(4)), attempt('n', yesterday, notes(5)), attempt('n', t(10), notes(3))]
    const p = rungProgress(a, 80, NOW)
    expect(p.rung2.missesToday).toBe(1)
    expect(p.rung2.stuck).toBe(false)
  })

  it('counts rung-3 misses after the last ready try toward stuck', () => {
    const a = empty()
    a.notes = [attempt('n', t(60), notes(0))]
    a.metronome = [attempt('m', t(40), READY), attempt('m', t(30), MISS), attempt('m', t(20), MISS), attempt('m', t(10), MISS)]
    expect(rungProgress(a, 80, NOW).rung3.stuck).toBe(true)
  })

  it('records which hands passed rung 1', () => {
    const a = empty()
    a.notesHand = [{ ...attempt('h', t(10), notes(0)), hand: 'left' }]
    const p = rungProgress(a, 80, NOW)
    expect(p.rung1.passed).toBe(true)
    expect(p.rung1.handsPassed).toEqual(['left'])
    expect(p.current).toBe('notes')
  })

  it("keeps rung 4's last passed tempo as the most recent pass", () => {
    const a = empty()
    a.notes = [attempt('n', t(90), notes(0))]
    a.metronome = [attempt('m', t(80), READY, { tempoBpm: 60 }), attempt('m', t(70), READY, { tempoBpm: 60 })]
    expect(rungProgress(a, 69, NOW).rung4.lastPassedTempo).toBe(60)
    a.tempo = [attempt('t', t(60), READY, { tempoBpm: 66 }), attempt('t', t(50), MISS, { tempoBpm: 69 })]
    expect(rungProgress(a, 69, NOW).rung4.lastPassedTempo).toBe(66)
  })
})

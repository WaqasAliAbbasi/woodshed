import { describe, expect, it } from 'vitest'
import type { Section } from '../db/db'
import { attempt, chunk, MIN, MISS, notes, NOW, READY, section } from './__fixtures__/attempts'
import { describeStep, piecePath } from './nextStep'
import type { PathAttempt } from './types'

const t = (minutesAgo: number) => NOW - minutesAgo * MIN

/** Sections and attempts that take chunk `idx` (range given) all the way to ready at `target`. */
function readyChunk(idx: number, range: [number, number], at: number, target = 80) {
  const id = `c${idx}`
  const sections = [section(`${id}-n`, id, 'notes', range), section(`${id}-m`, id, 'metronome', range)]
  const attempts = [
    attempt(`${id}-n`, at - 3 * MIN, notes(0)),
    attempt(`${id}-m`, at - 2 * MIN, READY, { tempoBpm: target }),
    attempt(`${id}-m`, at - MIN, READY, { tempoBpm: target }),
  ]
  return { sections, attempts }
}

function joinSection(k: number, range: [number, number]): Section {
  return section(`j${k}`, `c${k - 1}`, 'join', range)
}

const threeChunks = [chunk(0, 0, 4), chunk(1, 5, 8), chunk(2, 9, 12)]

describe('piecePath', () => {
  it('starts with chunk 1 at Notes', () => {
    const path = piecePath({ chunks: threeChunks, sections: [], attempts: [], targetTempoBpm: 80, now: NOW })
    expect(path.next).toEqual({ kind: 'chunk', idx: 0, rung: 'notes', stuck: false })
    expect(describeStep(path.next)).toBe('chunk 1 · notes')
  })

  it('snowballs: chunk 2 ready → join 1+2 before chunk 3', () => {
    const c0 = readyChunk(0, [0, 4], t(100))
    const c1 = readyChunk(1, [5, 8], t(50))
    const path = piecePath({
      chunks: threeChunks,
      sections: [...c0.sections, ...c1.sections],
      attempts: [...c0.attempts, ...c1.attempts],
      targetTempoBpm: 80,
      now: NOW,
    })
    expect(path.next).toEqual({ kind: 'join', k: 2, whole: false })
    expect(path.readyChunkCount).toBe(2)
  })

  it('hard-locks the whole piece until every chunk is ready and the previous join passed', () => {
    const c0 = readyChunk(0, [0, 4], t(100))
    const c1 = readyChunk(1, [5, 8], t(50))
    let sections = [...c0.sections, ...c1.sections]
    let attempts: PathAttempt[] = [...c0.attempts, ...c1.attempts]
    let path = piecePath({ chunks: threeChunks, sections, attempts, targetTempoBpm: 80, now: NOW })
    expect(path.wholeLock).toEqual({ remainingChunks: [3], waitingForJoin: undefined })
    expect(path.joins[1].available).toBe(false)

    const c2 = readyChunk(2, [9, 12], t(30))
    sections = [...sections, ...c2.sections, joinSection(2, [0, 8])]
    attempts = [...attempts, ...c2.attempts]
    path = piecePath({ chunks: threeChunks, sections, attempts, targetTempoBpm: 80, now: NOW })
    // Every chunk is ready, but join 1+2 hasn't passed yet.
    expect(path.wholeLock).toEqual({ remainingChunks: [], waitingForJoin: 2 })
    expect(path.next).toEqual({ kind: 'join', k: 2, whole: false })

    attempts = [...attempts, attempt('j2', t(20), READY)]
    path = piecePath({ chunks: threeChunks, sections, attempts, targetTempoBpm: 80, now: NOW })
    expect(path.wholeLock).toBeUndefined()
    expect(path.next).toEqual({ kind: 'join', k: 3, whole: true })
    expect(path.lastReadied).toEqual({ kind: 'join', k: 2, at: t(20) })

    sections = [...sections, joinSection(3, [0, 12])]
    attempts = [...attempts, attempt('j3', t(10), READY)]
    path = piecePath({ chunks: threeChunks, sections, attempts, targetTempoBpm: 80, now: NOW })
    expect(path.complete).toBe(true)
    expect(path.next).toEqual({ kind: 'complete' })
  })

  it('mirrors a repeat chunk’s status from its source, which opens joins straight through it', () => {
    const chunks = [chunk(0, 1, 4), chunk(1, 5, 8), chunk(2, 9, 12, 'c0')]
    const c0 = readyChunk(0, [1, 4], t(100))
    const c1 = readyChunk(1, [5, 8], t(80))
    const sections = [...c0.sections, ...c1.sections, joinSection(2, [1, 8])]
    const attempts = [...c0.attempts, ...c1.attempts, attempt('j2', t(60), READY)]
    const path = piecePath({ chunks, sections, attempts, targetTempoBpm: 80, now: NOW })
    expect(path.chunks[2].repeatOf).toBe(1)
    expect(path.chunks[2].progress.ready).toBe(true)
    expect(path.next).toEqual({ kind: 'join', k: 3, whole: true })
  })

  it('offers the seam drill after three join misses, and the join again after two ready seam tries', () => {
    const chunks = threeChunks.slice(0, 2)
    const c0 = readyChunk(0, [0, 4], t(100))
    const c1 = readyChunk(1, [5, 8], t(90))
    const sections = [...c0.sections, ...c1.sections, joinSection(2, [0, 8]), section('s2', 'c1', 'seam', [4, 5])]
    let attempts: PathAttempt[] = [
      ...c0.attempts,
      ...c1.attempts,
      attempt('j2', t(50), MISS),
      attempt('j2', t(45), MISS),
      attempt('j2', t(40), MISS),
    ]
    let path = piecePath({ chunks, sections, attempts, targetTempoBpm: 80, now: NOW })
    expect(path.next).toEqual({ kind: 'seam', k: 2 })
    expect(path.joins[0].seam).toMatchObject({ offered: true, startMeasure: 4, endMeasure: 5 })

    attempts = [...attempts, attempt('s2', t(30), READY), attempt('s2', t(25), READY)]
    path = piecePath({ chunks, sections, attempts, targetTempoBpm: 80, now: NOW })
    expect(path.next).toEqual({ kind: 'join', k: 2, whole: true })

    attempts = [...attempts, attempt('j2', t(20), MISS)]
    path = piecePath({ chunks, sections, attempts, targetTempoBpm: 80, now: NOW })
    expect(path.next).toEqual({ kind: 'join', k: 2, whole: true })
  })

  it('reports a stuck rung on the next step', () => {
    const sections = [section('n', 'c0', 'notes', [0, 4])]
    const attempts = [attempt('n', t(30), notes(5)), attempt('n', t(20), notes(4)), attempt('n', t(10), notes(3))]
    const path = piecePath({ chunks: threeChunks, sections, attempts, targetTempoBpm: 80, now: NOW })
    expect(path.next).toEqual({ kind: 'chunk', idx: 0, rung: 'notes', stuck: true })
  })

  it('ignores Free practice sections on the same measures', () => {
    const free: Section = { ...section('free', 'c0', 'notes', [0, 4]), chunkId: undefined, rung: undefined }
    const path = piecePath({ chunks: threeChunks, sections: [free], attempts: [attempt('free', t(5), notes(0))], targetTempoBpm: 80, now: NOW })
    expect(path.chunks[0].progress.rung2.passed).toBe(false)
  })

  it('treats a one-chunk piece as complete once that chunk is ready', () => {
    const c0 = readyChunk(0, [1, 4], t(10))
    const path = piecePath({ chunks: [chunk(0, 1, 4)], sections: c0.sections, attempts: c0.attempts, targetTempoBpm: 80, now: NOW })
    expect(path.complete).toBe(true)
    expect(path.joins).toEqual([])
  })
})

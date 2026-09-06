import { describe, expect, it } from 'vitest'
import type { Attempt, Section } from '../db/db'
import type { AttemptAggregate } from '../scoring/types'
import { summarizeSectionProgress } from './pieceProgress'
import { classifyAccuracy, isReadyToStopLooping, suggestNextStep } from './suggestNextStep'

function section(overrides: Partial<Section> = {}): Section {
  return {
    id: 's1',
    pieceId: 'p1',
    label: 'Measures 1-4',
    startMeasure: 1,
    endMeasure: 4,
    defaultTempoBpm: 80,
    createdAt: 0,
    ...overrides,
  }
}

function aggregate(pitchAccuracy: number, timingAccuracy: number): AttemptAggregate {
  return {
    expected: 10,
    correct: Math.round(pitchAccuracy * 10),
    missed: 0,
    extra: 0,
    onTime: Math.round(timingAccuracy * 10),
    early: 0,
    late: 0,
    pitchAccuracy,
    timingAccuracy,
  }
}

function attempt(overrides: Partial<Attempt> & { aggregate: AttemptAggregate }): Attempt {
  return {
    id: 'a1',
    sectionId: 's1',
    pieceId: 'p1',
    tempoBpm: 80,
    timestamp: 0,
    aborted: false,
    noteResults: [],
    ...overrides,
  }
}

/** Mirrors how callers (HistoryView) actually build the priority queue suggestNextStep now consumes. */
function progressFor(sections: Section[], attempts: Attempt[]) {
  return summarizeSectionProgress(sections, attempts)
}

describe('suggestNextStep', () => {
  it('suggests getting started when there are no attempts yet', () => {
    const result = suggestNextStep([], [])
    expect(result.headline).toMatch(/get started/i)
  })

  it('suggests repeating at the same tempo when pitch accuracy is low', () => {
    const attempts = [attempt({ tempoBpm: 72, timestamp: 1, aggregate: aggregate(0.5, 0.9) })]
    const result = suggestNextStep(progressFor([section()], attempts), attempts)
    expect(result.headline).toMatch(/repeat/i)
    expect(result.headline).toContain('72 BPM')
  })

  it('suggests repeating at the same tempo when timing accuracy is low', () => {
    const attempts = [attempt({ tempoBpm: 72, timestamp: 1, aggregate: aggregate(0.9, 0.4) })]
    const result = suggestNextStep(progressFor([section()], attempts), attempts)
    expect(result.headline).toMatch(/repeat/i)
  })

  it('suggests a faster tempo when both pitch and timing accuracy are high', () => {
    const attempts = [attempt({ tempoBpm: 90, timestamp: 1, aggregate: aggregate(0.98, 0.95) })]
    const result = suggestNextStep(progressFor([section()], attempts), attempts)
    expect(result.headline).toMatch(/bump/i)
    expect(result.headline).toContain('100 BPM')
  })

  it('suggests a faster tempo at 85% timing accuracy, not just 90%+', () => {
    const attempts = [attempt({ tempoBpm: 90, timestamp: 1, aggregate: aggregate(0.98, 0.85) })]
    const result = suggestNextStep(progressFor([section()], attempts), attempts)
    expect(result.headline).toMatch(/bump/i)
  })

  it('suggests staying the course in the middle band', () => {
    const attempts = [attempt({ tempoBpm: 90, timestamp: 1, aggregate: aggregate(0.88, 0.85) })]
    const result = suggestNextStep(progressFor([section()], attempts), attempts)
    expect(result.headline).toMatch(/keep working/i)
  })

  it('prioritizes the struggling section from the whole queue, not whichever was attempted most recently', () => {
    const strugglingButOlder = attempt({ id: 'a-old', sectionId: 's1', tempoBpm: 60, timestamp: 1, aggregate: aggregate(0.5, 0.5) })
    const readyButNewer = attempt({ id: 'a-new', sectionId: 's2', tempoBpm: 70, timestamp: 2, aggregate: aggregate(0.98, 0.95) })
    const sections = [section(), section({ id: 's2', label: 'Measures 5-8' })]
    const attempts = [strugglingButOlder, readyButNewer]
    const result = suggestNextStep(progressFor(sections, attempts), attempts)
    expect(result.headline).toContain('Measures 1-4')
    expect(result.headline).toMatch(/repeat/i)
  })

  it('lists the next struggling sections beyond the primary one as "also queued"', () => {
    const a1 = attempt({ id: 'a1', sectionId: 's1', timestamp: 1, aggregate: aggregate(0.5, 0.5) })
    const a2 = attempt({ id: 'a2', sectionId: 's2', timestamp: 2, aggregate: aggregate(0.5, 0.5) })
    const sections = [section(), section({ id: 's2', label: 'Measures 5-8' })]
    const attempts = [a1, a2]
    const result = suggestNextStep(progressFor(sections, attempts), attempts)
    expect(result.alsoQueued).toEqual(['Measures 5-8'])
  })

  it('omits alsoQueued when there is only one practiced section', () => {
    const attempts = [attempt({ timestamp: 1, aggregate: aggregate(0.9, 0.9) })]
    const result = suggestNextStep(progressFor([section()], attempts), attempts)
    expect(result.alsoQueued).toBeUndefined()
  })

  it('reports minutes practiced so far today when there has been an attempt today', () => {
    const now = Date.UTC(2026, 0, 15, 12, 0, 0)
    const attempts = [attempt({ timestamp: now - 5 * 60_000, durationMs: 5 * 60_000, aggregate: aggregate(0.9, 0.9) })]
    const result = suggestNextStep(progressFor([section()], attempts), attempts, now)
    expect(result.sessionNote).toMatch(/5 minutes?/i)
  })

  it('reports picking back up when the piece was not practiced today', () => {
    const now = Date.UTC(2026, 0, 15, 12, 0, 0)
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000
    const attempts = [attempt({ timestamp: twoDaysAgo, aggregate: aggregate(0.9, 0.9) })]
    const result = suggestNextStep(progressFor([section()], attempts), attempts, now)
    expect(result.sessionNote).toMatch(/last practiced/i)
  })
})

describe('classifyAccuracy', () => {
  it('is struggling below either threshold', () => {
    expect(classifyAccuracy(0.79, 0.9)).toBe('struggling')
    expect(classifyAccuracy(0.9, 0.69)).toBe('struggling')
  })

  it('is ready at/above both thresholds', () => {
    expect(classifyAccuracy(0.95, 0.85)).toBe('ready')
  })

  it('is progressing in the middle band', () => {
    expect(classifyAccuracy(0.88, 0.85)).toBe('progressing')
  })
})

describe('isReadyToStopLooping', () => {
  it('metronome mode: matches classifyAccuracy\'s "ready" band', () => {
    expect(isReadyToStopLooping('metronome', aggregate(0.98, 0.9))).toBe(true)
    expect(isReadyToStopLooping('metronome', aggregate(0.5, 0.9))).toBe(false)
  })

  it('notes mode: ready when the pass was completely clean (zero wrong notes), even if pitchAccuracy is a trivial 100%', () => {
    // Every SequenceMatcher completion has pitchAccuracy 1.0 by construction
    // (you must play the right note to advance) — extra is the only signal
    // that actually distinguishes a clean pass from a fumbling one.
    const clean = { ...aggregate(1, 1), extra: 0 }
    expect(isReadyToStopLooping('notes', clean)).toBe(true)
  })

  it('notes mode: not ready if any wrong notes were played, even with perfect pitchAccuracy', () => {
    const messy = { ...aggregate(1, 1), extra: 3 }
    expect(isReadyToStopLooping('notes', messy)).toBe(false)
  })
})

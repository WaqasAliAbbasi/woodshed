import { describe, expect, it } from 'vitest'
import type { Attempt, Section } from '../db/db'
import type { AttemptAggregate } from '../scoring/types'
import { summarizeSectionProgress } from './pieceProgress'

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

describe('summarizeSectionProgress', () => {
  it('omits sections with no attempts', () => {
    const result = summarizeSectionProgress(
      [section(), section({ id: 's2' })],
      [attempt({ sectionId: 's1', aggregate: aggregate(1, 1) })],
      undefined,
    )
    expect(result).toHaveLength(1)
    expect(result[0].section.id).toBe('s1')
  })

  it('reports attempt count, latest, and best (by combined pitch+timing) independently', () => {
    const worst = attempt({ id: 'a1', timestamp: 1, tempoBpm: 60, aggregate: aggregate(0.5, 0.5) })
    const bestOne = attempt({ id: 'a2', timestamp: 2, tempoBpm: 70, aggregate: aggregate(0.95, 0.9) })
    const mostRecent = attempt({ id: 'a3', timestamp: 3, tempoBpm: 80, aggregate: aggregate(0.6, 0.6) })

    const [summary] = summarizeSectionProgress([section()], [worst, bestOne, mostRecent], undefined)
    expect(summary.attemptCount).toBe(3)
    expect(summary.best.id).toBe('a2')
    expect(summary.latest.id).toBe('a3')
    expect(summary.status).toBe('struggling') // classified off the latest attempt, not the best
  })

  it('sorts struggling sections before progressing and ready ones', () => {
    const ready = section({ id: 's-ready', label: 'Ready section' })
    const struggling = section({ id: 's-struggling', label: 'Struggling section' })
    const progressing = section({ id: 's-progressing', label: 'Progressing section' })

    const result = summarizeSectionProgress(
      [ready, struggling, progressing],
      [
        attempt({ sectionId: 's-ready', timestamp: 1, aggregate: aggregate(0.98, 0.95) }),
        attempt({ sectionId: 's-struggling', timestamp: 2, aggregate: aggregate(0.4, 0.4) }),
        attempt({ sectionId: 's-progressing', timestamp: 3, aggregate: aggregate(0.88, 0.85) }),
      ],
      undefined,
    )

    expect(result.map((s) => s.section.id)).toEqual(['s-struggling', 's-progressing', 's-ready'])
  })

  it('within the same status, orders the stalest (oldest latest-attempt) section first', () => {
    const stale = section({ id: 's-stale' })
    const fresh = section({ id: 's-fresh' })

    const result = summarizeSectionProgress(
      [fresh, stale],
      [
        attempt({ sectionId: 's-fresh', timestamp: 100, aggregate: aggregate(0.4, 0.4) }),
        attempt({ sectionId: 's-stale', timestamp: 1, aggregate: aggregate(0.4, 0.4) }),
      ],
      undefined,
    )

    expect(result.map((s) => s.section.id)).toEqual(['s-stale', 's-fresh'])
  })
})

describe('summarizeSectionProgress: clearedAtTarget', () => {
  const clean = () => aggregate(0.98, 0.95)

  it('is false when no target tempo is set — nothing can clear a bar that does not exist', () => {
    const [summary] = summarizeSectionProgress([section()], [attempt({ tempoBpm: 200, aggregate: clean() })], undefined)
    expect(summary.clearedAtTarget).toBe(false)
  })

  it('is true for a clean attempt at the target, and for one above it', () => {
    const [at] = summarizeSectionProgress([section()], [attempt({ tempoBpm: 80, aggregate: clean() })], 80)
    expect(at.clearedAtTarget).toBe(true)

    const [above] = summarizeSectionProgress([section()], [attempt({ tempoBpm: 96, aggregate: clean() })], 80)
    expect(above.clearedAtTarget).toBe(true)
  })

  it('is false for a clean attempt below the target — playing it perfectly slowly is not the same as having it', () => {
    const [summary] = summarizeSectionProgress([section()], [attempt({ tempoBpm: 60, aggregate: clean() })], 80)
    expect(summary.clearedAtTarget).toBe(false)
  })

  it('is false for an at-tempo attempt that was not clean', () => {
    const [summary] = summarizeSectionProgress([section()], [attempt({ tempoBpm: 80, aggregate: aggregate(0.6, 0.6) })], 80)
    expect(summary.clearedAtTarget).toBe(false)
  })

  it('ignores aborted attempts, however clean the part that was played', () => {
    const [summary] = summarizeSectionProgress([section()], [attempt({ tempoBpm: 80, aborted: true, aggregate: clean() })], 80)
    expect(summary.clearedAtTarget).toBe(false)
  })

  it('survives a later slow run — it asks "have I ever got this", not "how did it just go"', () => {
    const cleared = attempt({ id: 'a1', timestamp: 1, tempoBpm: 80, aggregate: clean() })
    const slowWarmUp = attempt({ id: 'a2', timestamp: 2, tempoBpm: 50, aggregate: aggregate(0.5, 0.5) })

    const [summary] = summarizeSectionProgress([section()], [cleared, slowWarmUp], 80)
    expect(summary.clearedAtTarget).toBe(true)
    // ...while `status`, which drives the post-attempt stamp, still reflects that last run.
    expect(summary.status).toBe('struggling')
  })

  it('reverts once the target is raised past what was cleared', () => {
    const attempts = [attempt({ tempoBpm: 80, aggregate: clean() })]
    expect(summarizeSectionProgress([section()], attempts, 80)[0].clearedAtTarget).toBe(true)
    expect(summarizeSectionProgress([section()], attempts, 100)[0].clearedAtTarget).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { Attempt, Section } from '../db/db'
import type { AttemptAggregate } from '../scoring/types'
import { classifyAccuracy, suggestNextStep } from './suggestNextStep'

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

describe('suggestNextStep', () => {
  it('suggests getting started when there are no attempts yet', () => {
    const result = suggestNextStep([], [])
    expect(result.headline).toMatch(/get started/i)
  })

  it('suggests repeating at the same tempo when pitch accuracy is low', () => {
    const result = suggestNextStep(
      [section()],
      [attempt({ tempoBpm: 72, timestamp: 1, aggregate: aggregate(0.5, 0.9) })],
    )
    expect(result.headline).toMatch(/repeat/i)
    expect(result.headline).toContain('72 BPM')
  })

  it('suggests repeating at the same tempo when timing accuracy is low', () => {
    const result = suggestNextStep(
      [section()],
      [attempt({ tempoBpm: 72, timestamp: 1, aggregate: aggregate(0.9, 0.4) })],
    )
    expect(result.headline).toMatch(/repeat/i)
  })

  it('suggests a faster tempo when both pitch and timing accuracy are high', () => {
    const result = suggestNextStep(
      [section()],
      [attempt({ tempoBpm: 90, timestamp: 1, aggregate: aggregate(0.98, 0.95) })],
    )
    expect(result.headline).toMatch(/bump/i)
    expect(result.headline).toContain('100 BPM')
  })

  it('suggests a faster tempo at 85% timing accuracy, not just 90%+', () => {
    const result = suggestNextStep(
      [section()],
      [attempt({ tempoBpm: 90, timestamp: 1, aggregate: aggregate(0.98, 0.85) })],
    )
    expect(result.headline).toMatch(/bump/i)
  })

  it('suggests staying the course in the middle band', () => {
    const result = suggestNextStep(
      [section()],
      [attempt({ tempoBpm: 90, timestamp: 1, aggregate: aggregate(0.88, 0.85) })],
    )
    expect(result.headline).toMatch(/keep working/i)
  })

  it('bases the suggestion on the most recently attempted section, not the first one', () => {
    const older = attempt({
      id: 'a-old',
      sectionId: 's1',
      tempoBpm: 60,
      timestamp: 1,
      aggregate: aggregate(0.98, 0.95),
    })
    const newer = attempt({
      id: 'a-new',
      sectionId: 's2',
      tempoBpm: 70,
      timestamp: 2,
      aggregate: aggregate(0.5, 0.5),
    })
    const result = suggestNextStep([section(), section({ id: 's2', label: 'Measures 5-8' })], [older, newer])
    expect(result.headline).toContain('Measures 5-8')
    expect(result.headline).toContain('70 BPM')
  })

  it('falls back to a generic label when the section no longer exists', () => {
    const result = suggestNextStep([], [attempt({ timestamp: 1, aggregate: aggregate(0.5, 0.5) })])
    expect(result.headline).toMatch(/that section/i)
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

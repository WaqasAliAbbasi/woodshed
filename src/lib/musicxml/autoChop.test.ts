import { describe, expect, it } from 'vitest'
import { autoChopSections } from './autoChop'

describe('autoChopSections', () => {
  it('chunks an even multiple of the chunk size into equal sections', () => {
    expect(autoChopSections(1, 12, 4)).toEqual([
      { range: { startMeasure: 1, endMeasure: 4 }, label: 'Measures 1–4' },
      { range: { startMeasure: 5, endMeasure: 8 }, label: 'Measures 5–8' },
      { range: { startMeasure: 9, endMeasure: 12 }, label: 'Measures 9–12' },
    ])
  })

  it('folds a short trailing remainder into the previous section instead of a lonely tiny one', () => {
    // 9 measures / chunk 4 -> naive chunking would leave a 1-measure tail
    const sections = autoChopSections(1, 9, 4)
    expect(sections).toEqual([
      { range: { startMeasure: 1, endMeasure: 4 }, label: 'Measures 1–4' },
      { range: { startMeasure: 5, endMeasure: 9 }, label: 'Measures 5–9' },
    ])
  })

  it('keeps a trailing remainder of at least half the chunk size as its own section', () => {
    const sections = autoChopSections(1, 10, 4)
    expect(sections).toEqual([
      { range: { startMeasure: 1, endMeasure: 4 }, label: 'Measures 1–4' },
      { range: { startMeasure: 5, endMeasure: 8 }, label: 'Measures 5–8' },
      { range: { startMeasure: 9, endMeasure: 10 }, label: 'Measures 9–10' },
    ])
  })

  it('returns the whole piece as one section when it is shorter than the chunk size', () => {
    expect(autoChopSections(1, 3, 4)).toEqual([{ range: { startMeasure: 1, endMeasure: 3 }, label: 'Measures 1–3' }])
  })

  it('labels a single-measure section without a dash', () => {
    expect(autoChopSections(5, 5, 4)).toEqual([{ range: { startMeasure: 5, endMeasure: 5 }, label: 'Measure 5' }])
  })

  it('handles a pickup measure numbered 0 as the first measure', () => {
    const sections = autoChopSections(0, 7, 4)
    expect(sections[0].range).toEqual({ startMeasure: 0, endMeasure: 3 })
  })

  it('returns nothing for an empty range', () => {
    expect(autoChopSections(5, 4)).toEqual([])
  })
})

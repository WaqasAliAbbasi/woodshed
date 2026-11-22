import { describe, expect, it } from 'vitest'
import { goalHeadline, minutesByPiece, shareInWords } from './weeklyStats'

const s = (minutes: number, pieceIds: string[]) => ({ id: String(Math.random()), startedAt: 0, endedAt: minutes * 60_000, pieceIds })

describe('minutesByPiece', () => {
  it('splits a multi-piece session evenly and keeps unlabelled practice apart', () => {
    const m = minutesByPiece([s(30, ['a']), s(20, ['a', 'b']), s(15, [])])
    expect(m.get('a')).toBe(40)
    expect(m.get('b')).toBe(10)
    expect(m.get('')).toBe(15)
  })
})

describe('goalHeadline', () => {
  it('counts weeks at or over four days', () => {
    expect(goalHeadline([{ practiceDays: 6 }, { practiceDays: 4 }, { practiceDays: 1 }])).toBe('4 or more practice days in 2 of the last 3 weeks')
  })
})

describe('shareInWords', () => {
  it('rounds a share into words', () => {
    expect(shareInWords(0.75)).toBe('Three quarters')
    expect(shareInWords(0.5)).toBe('About half')
    expect(shareInWords(0.1)).toBe('A small share')
  })
})

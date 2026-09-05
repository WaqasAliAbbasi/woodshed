import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateId } from './id'

describe('generateId', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses crypto.randomUUID when available', () => {
    const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-1111-1111-111111111111')
    expect(generateId()).toBe('11111111-1111-1111-1111-111111111111')
    spy.mockRestore()
  })

  it('falls back to a non-crypto id when crypto.randomUUID is unavailable (e.g. an insecure-context Safari)', () => {
    const original = crypto.randomUUID
    // @ts-expect-error simulating a browser/context where this API doesn't exist
    delete crypto.randomUUID
    try {
      const id = generateId()
      expect(id).toEqual(expect.any(String))
      expect(id.length).toBeGreaterThan(0)
    } finally {
      crypto.randomUUID = original
    }
  })

  it('generates unique ids across repeated calls in the fallback path', () => {
    const original = crypto.randomUUID
    // @ts-expect-error simulating a browser/context where this API doesn't exist
    delete crypto.randomUUID
    try {
      const ids = new Set(Array.from({ length: 20 }, () => generateId()))
      expect(ids.size).toBe(20)
    } finally {
      crypto.randomUUID = original
    }
  })
})

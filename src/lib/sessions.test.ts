import { describe, expect, it } from 'vitest'
import { attemptWindow, clusterWindows, mergeWindows, SESSION_GAP_MS, windowsCluster } from './sessions'

describe('attemptWindow', () => {
  it('walks backward from the finish timestamp by durationMs', () => {
    expect(attemptWindow({ timestamp: 10_000, durationMs: 3_000 })).toEqual({ startedAt: 7_000, endedAt: 10_000 })
  })

  it('treats a missing durationMs as an instantaneous window', () => {
    expect(attemptWindow({ timestamp: 10_000 })).toEqual({ startedAt: 10_000, endedAt: 10_000 })
  })
})

describe('windowsCluster', () => {
  it('clusters overlapping windows', () => {
    expect(windowsCluster({ startedAt: 0, endedAt: 100 }, { startedAt: 50, endedAt: 150 })).toBe(true)
  })

  it('clusters windows within the gap threshold', () => {
    const a = { startedAt: 0, endedAt: 1_000 }
    const b = { startedAt: 1_000 + SESSION_GAP_MS, endedAt: 2_000 + SESSION_GAP_MS }
    expect(windowsCluster(a, b)).toBe(true)
  })

  it('does not cluster windows further apart than the gap threshold', () => {
    const a = { startedAt: 0, endedAt: 1_000 }
    const b = { startedAt: 1_000 + SESSION_GAP_MS + 1, endedAt: 2_000 }
    expect(windowsCluster(a, b)).toBe(false)
  })

  it('is symmetric regardless of argument order', () => {
    const a = { startedAt: 0, endedAt: 1_000 }
    const b = { startedAt: 1_000 + SESSION_GAP_MS + 1, endedAt: 2_000 }
    expect(windowsCluster(a, b)).toBe(windowsCluster(b, a))
  })
})

describe('mergeWindows', () => {
  it('takes the union of two windows', () => {
    expect(mergeWindows({ startedAt: 100, endedAt: 200 }, { startedAt: 50, endedAt: 150 })).toEqual({
      startedAt: 50,
      endedAt: 200,
    })
  })
})

describe('clusterWindows', () => {
  it('returns an empty array for no windows', () => {
    expect(clusterWindows([])).toEqual([])
  })

  it('groups a single window alone', () => {
    const w = { startedAt: 0, endedAt: 100 }
    expect(clusterWindows([w])).toEqual([[w]])
  })

  it('merges two overlapping windows into one cluster', () => {
    const a = { startedAt: 0, endedAt: 100 }
    const b = { startedAt: 50, endedAt: 150 }
    expect(clusterWindows([a, b])).toEqual([[a, b]])
  })

  it('keeps windows further apart than the gap threshold in separate clusters', () => {
    const a = { startedAt: 0, endedAt: 1_000 }
    const b = { startedAt: 1_000 + SESSION_GAP_MS + 1, endedAt: 2_000 }
    expect(clusterWindows([a, b])).toEqual([[a], [b]])
  })

  it('is order-independent (out-of-order delivery clusters the same way)', () => {
    const a = { id: 'a', startedAt: 0, endedAt: 100 }
    const b = { id: 'b', startedAt: 200, endedAt: 300 }
    const c = { id: 'c', startedAt: 150, endedAt: 250 } // bridges a and b
    const forward = clusterWindows([a, b, c]).map((cluster) => cluster.map((w) => w.id).sort())
    const shuffled = clusterWindows([c, a, b]).map((cluster) => cluster.map((w) => w.id).sort())
    expect(forward).toEqual([['a', 'b', 'c']])
    expect(shuffled).toEqual(forward)
  })

  it('transitively bridges a chain even when no two windows directly overlap', () => {
    // a=[0,10], b=[10+gap, 20+gap], c=[20+2*gap, 30+2*gap] — each pair is
    // exactly at the gap threshold from its neighbor, so a and c never
    // directly cluster, but the sweep still finds one connected component.
    const a = { id: 'a', startedAt: 0, endedAt: 10 }
    const b = { id: 'b', startedAt: 10 + SESSION_GAP_MS, endedAt: 20 + SESSION_GAP_MS }
    const c = { id: 'c', startedAt: 20 + 2 * SESSION_GAP_MS, endedAt: 30 + 2 * SESSION_GAP_MS }
    const clusters = clusterWindows([a, b, c])
    expect(clusters).toHaveLength(1)
    expect(clusters[0].map((w) => w.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('sorts multiple resulting clusters and their contents deterministically by start time', () => {
    const late = { id: 'late', startedAt: SESSION_GAP_MS * 10, endedAt: SESSION_GAP_MS * 10 + 100 }
    const early = { id: 'early', startedAt: 0, endedAt: 100 }
    const clusters = clusterWindows([late, early])
    expect(clusters.map((c) => c.map((w) => w.id))).toEqual([['early'], ['late']])
  })
})

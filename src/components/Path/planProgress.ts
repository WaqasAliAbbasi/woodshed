import { DEFAULT_BUDGET_MINUTES } from '../../lib/path/buildDailyPlan'

/**
 * Which of today's plan steps this browser has ticked off, and the chosen
 * budget. A per-viewer convenience only (the plan itself is recomputed
 * from server data every time), so localStorage, keyed by day, wrapped in
 * try/catch: private windows and cleared storage just start the day fresh.
 */
const KEY = 'woodshed:plan'

interface Stored {
  day: string
  done: string[]
  budget?: number
}

function dayKey(now = Date.now()): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function read(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null
    if (raw && raw.day === dayKey()) return raw
    return { day: dayKey(), done: [], budget: raw?.budget }
  } catch {
    return { day: dayKey(), done: [] }
  }
}

function write(value: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // Storage unavailable — the ticks just don't persist.
  }
}

export function doneSteps(): Set<string> {
  return new Set(read().done)
}

export function markStepDone(key: string): void {
  const stored = read()
  if (!stored.done.includes(key)) write({ ...stored, done: [...stored.done, key] })
}

export function getBudget(): number {
  return read().budget ?? DEFAULT_BUDGET_MINUTES
}

export function setBudget(budget: number): void {
  write({ ...read(), budget })
}

import type { AttemptAggregate, NoteResult } from './types'

export function aggregate(results: NoteResult[], expectedCount: number): AttemptAggregate {
  let correct = 0
  let missed = 0
  let extra = 0
  let onTime = 0
  let early = 0
  let late = 0

  for (const result of results) {
    switch (result.classification) {
      case 'onTime':
        correct++
        onTime++
        break
      case 'early':
        correct++
        early++
        break
      case 'late':
        correct++
        late++
        break
      case 'missed':
        missed++
        break
      case 'extra':
        extra++
        break
    }
  }

  return {
    expected: expectedCount,
    correct,
    missed,
    extra,
    onTime,
    early,
    late,
    pitchAccuracy: expectedCount > 0 ? correct / expectedCount : 0,
    timingAccuracy: correct > 0 ? onTime / correct : 0,
  }
}

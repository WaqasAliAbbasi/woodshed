import type { AttemptAggregate, HandBalance, NoteResult } from './types'

/**
 * Average note-on velocity per hand, from correctly-matched notes only
 * (onTime/early/late) — missed notes were never played, and extra (wrong)
 * notes have no expected hand to attribute. Returns undefined when there's
 * nothing to compare: hands-separate practice, a single-staff piece, or no
 * velocity data at all (e.g. the virtual on-screen keyboard, which always
 * sends the same fixed velocity).
 */
function computeHandBalance(results: NoteResult[]): HandBalance | undefined {
  let leftSum = 0
  let leftCount = 0
  let rightSum = 0
  let rightCount = 0

  for (const result of results) {
    if (result.velocity === undefined) continue
    if (result.classification !== 'onTime' && result.classification !== 'early' && result.classification !== 'late') continue
    if (result.hand === 'left') {
      leftSum += result.velocity
      leftCount++
    } else if (result.hand === 'right') {
      rightSum += result.velocity
      rightCount++
    }
  }

  if (leftCount === 0 || rightCount === 0) return undefined
  return {
    leftAvgVelocity: leftSum / leftCount,
    rightAvgVelocity: rightSum / rightCount,
    leftNoteCount: leftCount,
    rightNoteCount: rightCount,
  }
}

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
    timingAccuracy: expectedCount > 0 ? onTime / expectedCount : 0,
    timingAccuracyOfCorrect: correct > 0 ? onTime / correct : 0,
    handBalance: computeHandBalance(results),
  }
}

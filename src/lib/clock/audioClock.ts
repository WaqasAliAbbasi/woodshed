let sharedAudioContext: AudioContext | undefined

/** A single shared AudioContext for the whole app — browsers cap how many can exist. */
export function getAudioContext(): AudioContext {
  sharedAudioContext ??= new AudioContext()
  return sharedAudioContext
}

export interface ClockCorrelation {
  /** audioClockTimeSec = performanceTimeMs / 1000 + offsetSec */
  offsetSec: number
}

/**
 * `MIDIMessageEvent.timeStamp` is on the `performance.now()` clock; Web
 * Audio scheduling uses `AudioContext.currentTime`, a *different* clock and
 * epoch. Comparing them directly silently produces systematically-wrong
 * timing scores. `getOutputTimestamp()` gives a matched pair on both clocks
 * at the same instant, from which the offset between them is derived.
 * Call this fresh at the start of each attempt rather than assuming a
 * single correlation holds for an entire session.
 */
export function correlateClock(audioContext: AudioContext): ClockCorrelation {
  const { contextTime, performanceTime } = audioContext.getOutputTimestamp()
  const resolvedContextTime = contextTime ?? audioContext.currentTime
  const resolvedPerformanceTime = performanceTime ?? performance.now()
  return { offsetSec: resolvedContextTime - resolvedPerformanceTime / 1000 }
}

export function midiTimeStampToAudioTime(correlation: ClockCorrelation, midiTimeStampMs: number): number {
  return midiTimeStampMs / 1000 + correlation.offsetSec
}

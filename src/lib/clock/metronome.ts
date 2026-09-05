const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_SEC = 0.1
const CLICK_DURATION_SEC = 0.05

/**
 * Classic Web Audio "lookahead scheduler" (per Chris Wilson's "A Tale of
 * Two Clocks"): a coarse `setInterval` tick just decides which upcoming
 * beats to schedule, but each beat's actual sound is scheduled at a precise
 * `AudioContext.currentTime`-relative timestamp via `osc.start(t)` — so
 * playback timing is sample-accurate regardless of JS timer jitter.
 */
export class Metronome {
  private readonly audioContext: AudioContext
  private tempoBpm: number
  private readonly beatsPerMeasure: number
  private nextBeatTime = 0
  private beatIndex = 0
  private timerId: ReturnType<typeof setInterval> | undefined
  private onBeat: ((beatIndex: number, timeSec: number) => void) | undefined

  constructor(audioContext: AudioContext, tempoBpm: number, beatsPerMeasure: number) {
    this.audioContext = audioContext
    this.tempoBpm = tempoBpm
    this.beatsPerMeasure = beatsPerMeasure
  }

  private get secondsPerBeat(): number {
    return 60 / this.tempoBpm
  }

  /** Begins scheduling clicks starting at `startTimeSec` (audio-clock time). `onBeat` fires as each beat is scheduled, not when it sounds. */
  start(startTimeSec: number, onBeat: (beatIndex: number, timeSec: number) => void): void {
    this.nextBeatTime = startTimeSec
    this.beatIndex = 0
    this.onBeat = onBeat
    this.timerId = setInterval(() => this.scheduleAheadBeats(), LOOKAHEAD_MS)
    this.scheduleAheadBeats()
  }

  stop(): void {
    if (this.timerId !== undefined) {
      clearInterval(this.timerId)
      this.timerId = undefined
    }
  }

  private scheduleAheadBeats(): void {
    while (this.nextBeatTime < this.audioContext.currentTime + SCHEDULE_AHEAD_SEC) {
      const isDownbeat = this.beatIndex % this.beatsPerMeasure === 0
      this.playClick(this.nextBeatTime, isDownbeat)
      this.onBeat?.(this.beatIndex, this.nextBeatTime)
      this.nextBeatTime += this.secondsPerBeat
      this.beatIndex++
    }
  }

  private playClick(timeSec: number, accented: boolean): void {
    const ctx = this.audioContext
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.frequency.value = accented ? 1500 : 1000
    gain.gain.setValueAtTime(0.4, timeSec)
    gain.gain.exponentialRampToValueAtTime(0.001, timeSec + CLICK_DURATION_SEC)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(timeSec)
    oscillator.stop(timeSec + CLICK_DURATION_SEC)
  }
}

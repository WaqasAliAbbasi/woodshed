import type { ExpectedChordEvent } from '../musicxml/types'

const NOTE_GAIN = 0.18
const ATTACK_SEC = 0.01
const RELEASE_SEC = 0.12
/** Chords have no natural "how long to ring" from the score alone (durationSec is "informational only" — see ExpectedChordEvent) — clamp to a range that reads as a held note without ringing on top of the next one at a fast tempo. */
const MIN_NOTE_SEC = 0.15
const MAX_NOTE_SEC = 1.2
/** Extra tail after a note's gain has reached zero, so `osc.stop()` never lands mid-ramp and clicks. */
const STOP_MARGIN_SEC = 0.02
/** How long a manually-stopped note fades out, rather than cutting off with a click. */
const FADE_OUT_SEC = 0.03

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Schedules a simple synthesised (triangle-wave) playback of an expected
 * timeline against `AudioContext.currentTime`, the same way `Metronome`
 * schedules clicks — see its doc comment on why sample-accurate scheduling
 * needs `osc.start(t)` rather than a JS timer. Unlike `Metronome`, playback
 * covers a short, finite range, so everything is scheduled up front in one
 * pass rather than via an incremental lookahead loop.
 */
export class Playback {
  private readonly audioContext: AudioContext
  private activeGains: GainNode[] = []
  private finishTimeoutId: ReturnType<typeof setTimeout> | undefined

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext
  }

  /** Schedules `events` to start sounding at `startTimeSec` (audio-clock time). `onFinished` fires once, after the last scheduled note has finished — not when scheduling completes. Cancels anything still scheduled from a previous `start()` first. */
  start(events: ExpectedChordEvent[], startTimeSec: number, onFinished?: () => void): void {
    this.stop()
    if (events.length === 0) {
      onFinished?.()
      return
    }

    let latestEndSec = startTimeSec
    for (const event of events) {
      const noteDurationSec = Math.min(MAX_NOTE_SEC, Math.max(MIN_NOTE_SEC, event.durationSec))
      const noteStartSec = startTimeSec + event.onsetSec
      latestEndSec = Math.max(latestEndSec, noteStartSec + noteDurationSec)
      for (const midi of event.midiNumbers) {
        this.playNote(midi, noteStartSec, noteDurationSec)
      }
    }

    const delayMs = Math.max(0, (latestEndSec - this.audioContext.currentTime) * 1000)
    this.finishTimeoutId = setTimeout(() => {
      this.activeGains = []
      this.finishTimeoutId = undefined
      onFinished?.()
    }, delayMs)
  }

  private playNote(midi: number, startSec: number, durationSec: number): void {
    const ctx = this.audioContext
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'triangle'
    oscillator.frequency.value = midiToFrequency(midi)

    const attackEndSec = startSec + Math.min(ATTACK_SEC, durationSec / 2)
    const releaseStartSec = Math.max(attackEndSec, startSec + durationSec - RELEASE_SEC)
    gain.gain.setValueAtTime(0, startSec)
    gain.gain.linearRampToValueAtTime(NOTE_GAIN, attackEndSec)
    gain.gain.setValueAtTime(NOTE_GAIN, releaseStartSec)
    gain.gain.linearRampToValueAtTime(0, startSec + durationSec)

    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(startSec)
    oscillator.stop(startSec + durationSec + STOP_MARGIN_SEC)
    this.activeGains.push(gain)
  }

  /** Stops any in-flight or still-scheduled playback immediately, fading out whatever is currently sounding rather than cutting it off with a click. Safe to call even if nothing is playing. */
  stop(): void {
    if (this.finishTimeoutId !== undefined) {
      clearTimeout(this.finishTimeoutId)
      this.finishTimeoutId = undefined
    }
    const now = this.audioContext.currentTime
    for (const gain of this.activeGains) {
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(gain.gain.value, now)
      gain.gain.linearRampToValueAtTime(0, now + FADE_OUT_SEC)
    }
    this.activeGains = []
  }
}

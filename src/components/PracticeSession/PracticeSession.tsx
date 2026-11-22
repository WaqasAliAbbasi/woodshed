import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isReadyToStopLooping, SECTION_STATUS_LABEL } from '../../lib/coach/suggestNextStep'
import type { SectionProgress } from '../../lib/coach/pieceProgress'
import type { Piece } from '../../lib/db/db'
import { resolveSection } from '../../lib/db/resolveSection'
import type { HandFilter } from '../../lib/musicxml/buildExpectedTimeline'
import type { MeasureRange } from '../../lib/musicxml/types'
import type { PracticeMode } from '../../lib/scoring/types'
import { HandFilterControl } from '../HandFilterControl/HandFilterControl'
import type { UseMidiInputResult } from '../InputSourceSelector/useMidiInput'
import { PracticeModeControl } from '../PracticeModeControl/PracticeModeControl'
import { usePracticeEngine, type AttemptSettings } from './usePracticeEngine'

/**
 * Pause after an attempt finishes before Loop mode auto-repeats — long
 * enough to actually read the result (pitch/timing %, hand balance, note
 * tally), short enough to keep drilling. Was 1500ms; too short in practice
 * for someone reading multiple stats while sitting at the keyboard rather
 * than at the mouse — the loop toggle is the only way to cancel a pending
 * repeat, and 1.5s often wasn't enough time to even notice one was coming.
 */
const LOOP_REPEAT_DELAY_MS = 4000

export function PracticeSession({
  osmd,
  piece,
  midi,
  range,
  handFilter,
  onHandFilterChange,
  mode,
  onModeChange,
  staffCount,
  onEditableChange,
  onAttemptRecorded,
  progress,
  tempoBpm,
}: {
  osmd: OpenSheetMusicDisplay
  piece: Piece
  midi: UseMidiInputResult
  range: MeasureRange
  handFilter: HandFilter
  onHandFilterChange: (handFilter: HandFilter) => void
  mode: PracticeMode
  onModeChange: (mode: PracticeMode) => void
  /** Pieces with only one staff have nothing to isolate — the hand picker is hidden in that case. */
  staffCount: number
  onEditableChange: (editable: boolean) => void
  onAttemptRecorded: (sectionId: string) => void
  /** Looked up (by the just-completed section's id) to stamp the result with its overall struggling/progressing/ready status — not derived from this one attempt alone. */
  progress: SectionProgress[]
  /**
   * The piece's target tempo, owned by the header's TargetTempoChip and
   * saved on the piece — attempts are played at it, and it's the bar
   * `clearedAtTarget` judges them against. Practising is no longer a
   * separate dial from the goal: moving one moves the other, which is what
   * makes "get everything green, then raise it" a single loop.
   */
  tempoBpm: number
}) {
  const [loopEnabled, setLoopEnabled] = useState(false)
  const deckRef = useRef<HTMLDivElement>(null)

  const settings = useMemoSettings(range, tempoBpm, handFilter, mode)
  const pieceId = piece.id
  const resolveSectionId = useCallback(
    async (s: AttemptSettings) => (await resolveSection(pieceId, s.range, s.tempoBpm, s.handFilter, s.mode)).id,
    [pieceId],
  )
  const engine = usePracticeEngine({ osmd, pieceId, midi, settings, resolveSectionId, onAttemptRecorded })
  const { state, dispatch, editable, currentBeat, beatsPerMeasure, isPlayingBack } = engine

  // The fixed deck's height varies with practice state (idle controls, result
  // stats, the loop toggle — plus wrapping on narrow screens), so a fixed
  // page bottom-padding guess drifts out of sync and lets the deck cover
  // page content like the practice log. Measure it and feed it back as a CSS
  // var that .app's padding-bottom is built from instead (see App.css).
  useEffect(() => {
    const deck = deckRef.current
    if (!deck) return
    const setHeightVar = () => {
      document.documentElement.style.setProperty('--practice-deck-height', `${deck.offsetHeight}px`)
    }
    setHeightVar()
    const observer = new ResizeObserver(setHeightVar)
    observer.observe(deck)
    return () => {
      observer.disconnect()
      document.documentElement.style.removeProperty('--practice-deck-height')
    }
  }, [])

  // Loop mode: drill the same section, at the same tempo, until it comes
  // together (see isReadyToStopLooping) — then switch itself off. The tempo
  // is deliberately never raised for you: working a whole piece at one speed
  // and stepping up only when *you* decide to is the practice habit this is
  // built around, so a tempo change is always an explicit move on the
  // TempoControl. Stopping an attempt early (aborted) is treated as "I want
  // out" and turns the loop off rather than immediately restarting, since
  // that's the only way to interrupt a loop.
  useEffect(() => {
    if (!loopEnabled || state.status !== 'AttemptComplete') return
    if (state.aggregate.expected === 0 && !state.aborted) return // nothing playable in this range/hand combo — nothing to loop toward
    // Switched off from a timer callback, not synchronously in the effect.
    const stop = state.aborted || isReadyToStopLooping(state.mode, state.aggregate)
    const timeout = setTimeout(() => (stop ? setLoopEnabled(false) : dispatch({ type: 'repeat' })), stop ? 0 : LOOP_REPEAT_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [state, loopEnabled, dispatch])

  const handleStart = async () => {
    if (state.status !== 'SectionConfigured') return
    onEditableChange(false)
    await engine.start()
  }

  const handlePlayRange = () => {
    if (state.status !== 'SectionConfigured') return
    engine.playRange(state)
  }

  const handleStopPlayback = engine.stopPlayback

  const handleAdjust = () => {
    onEditableChange(true)
    dispatch({ type: 'adjust' })
  }

  const handleDone = () => {
    onEditableChange(true)
    dispatch({ type: 'done' })
  }

  const isLive = state.status === 'CountingIn' || state.status === 'Attempting'
  // Swings fully left at the downbeat and fully right at the last beat of the measure — a single
  // real-time readout of where the audio clock actually is, not a decorative loop of its own.
  const needleAngle = isLive && beatsPerMeasure > 1 ? -24 + (currentBeat / (beatsPerMeasure - 1)) * 48 : 0
  // Only meaningful once this attempt's section has a rolled-up status from the *whole* practice
  // history (not just this one attempt) — may briefly be undefined right after scoring, until the
  // progress summary above has refetched to include this attempt.
  const sectionStatus =
    state.status === 'AttemptComplete'
      ? progress.find((p) => p.section.id === engine.sectionId)?.status
      : undefined
  const handBalance = state.status === 'AttemptComplete' ? state.aggregate.handBalance : undefined
  // Rounded so the two segments always sum to exactly 100% (avoids a hairline gap or overlap from rounding each independently).
  const leftBalancePct = handBalance
    ? Math.round((100 * handBalance.leftAvgVelocity) / (handBalance.leftAvgVelocity + handBalance.rightAvgVelocity))
    : 0
  const showLoopToggle = state.status === 'SectionConfigured' || state.status === 'AttemptComplete'

  return (
    <div className="practice-session">
      <div className="practice-action-bar">
        <div className="deck" ref={deckRef}>
          {/* Section, settings and actions share one row: the deck is fixed
              to the bottom of every screen, so each stacked row it used to
              have was permanent height taken off the score above it. */}
          <div className="deck-row deck-bar">
            {/* Measures only. The hand and mode controls sit right beside
                this saying the same thing, and a label that grows by "
                (Notes)" when you switch mode pushes the row over its width
                and wraps the buttons onto a second line. The suffixes still
                belong on the *stored* section label (see resolveSection),
                where there's no control next to it to say which is which. */}
            <span className="practice-section-label">
              Measures {range.startMeasure}–{range.endMeasure}
            </span>

            {editable && (
              <>
                <PracticeModeControl mode={mode} onChange={onModeChange} disabled={!editable} />
                {staffCount > 1 && (
                  <HandFilterControl handFilter={handFilter} onChange={onHandFilterChange} disabled={!editable} />
                )}
              </>
            )}

            {mode === 'metronome' && (
              <div className={`metronome${isLive ? ' metronome-live' : ''}`}>
                <div className="metronome-base" />
                <div className="metronome-needle" style={{ transform: `rotate(${needleAngle}deg)` }} />
                <div className="metronome-ticks">
                  {Array.from({ length: beatsPerMeasure }, (_, i) => (
                    <span key={i} className={`metronome-tick${isLive && i === currentBeat ? ' metronome-tick-active' : ''}`} />
                  ))}
                </div>
              </div>
            )}

            <div className="deck-actions">
              {showLoopToggle && (
                <button
                  type="button"
                  className={`btn-toggle${loopEnabled ? ' btn-toggle-active' : ''}`}
                  aria-pressed={loopEnabled}
                  onClick={() => setLoopEnabled((on) => !on)}
                  title="Loop until ready"
                >
                  Loop
                </button>
              )}
              {state.status === 'SectionConfigured' &&
                (isPlayingBack ? (
                  <button type="button" className="btn-toggle btn-toggle-active" onClick={handleStopPlayback}>
                    Stop playback
                  </button>
                ) : (
                  <button type="button" className="btn-toggle" onClick={handlePlayRange} title="Hear the selected range">
                    ▶ Play
                  </button>
                ))}
              {state.status === 'SectionConfigured' && (
                <button type="button" className="btn-primary btn-go" onClick={() => void handleStart()} disabled={!midi.connected}>
                  Start
                </button>
              )}
              {isLive && (
                <button type="button" className="btn-go" onClick={() => dispatch({ type: 'stop' })}>
                  Stop
                </button>
              )}
              {state.status === 'AttemptComplete' && (
                <div className="result-actions">
                  <button type="button" onClick={() => dispatch({ type: 'repeat' })}>
                    Repeat
                  </button>
                  <button type="button" onClick={handleAdjust}>
                    Change section
                  </button>
                  <button type="button" className="btn-primary" onClick={handleDone}>
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>

          {!midi.connected && state.status === 'SectionConfigured' && (
            <div className="deck-row deck-status-text">
              <span className="practice-hint">Connect a MIDI device to start practicing.</span>
            </div>
          )}

          {isLive && (
            <div className="deck-row deck-status-text">
              <span className="status-word">
                {state.status === 'CountingIn' ? 'Count-in…' : 'Playing…'}
                {loopEnabled && ' · Looping'}
              </span>
            </div>
          )}

          {state.status === 'AttemptComplete' && (
            <div className="deck-row deck-result">
              {state.aborted && <span className="banner banner-warning practice-result-aborted">Stopped early</span>}
              {state.aggregate.expected === 0 ? (
                <span className="practice-result-text">
                  No {handFilter === 'both' ? '' : `${handFilter}-hand `}notes in this section — try a different range
                  or hand.
                </span>
              ) : (
                <>
                  <div className="stat-row">
                    <div className="stat">
                      <span className="stat-label">Pitch</span>
                      <span className="stat-value">{Math.round(state.aggregate.pitchAccuracy * 100)}%</span>
                      <span className="stat-bar">
                        <span style={{ width: `${Math.round(state.aggregate.pitchAccuracy * 100)}%` }} />
                      </span>
                    </div>
                    {mode === 'metronome' && (
                      <div className="stat">
                        <span className="stat-label">Timing</span>
                        <span
                          className="stat-value"
                          title={
                            state.aggregate.timingAccuracyOfCorrect !== undefined && state.aggregate.correct < state.aggregate.expected
                              ? `${Math.round(state.aggregate.timingAccuracyOfCorrect * 100)}% of the notes you played were on time`
                              : undefined
                          }
                        >
                          {Math.round(state.aggregate.timingAccuracy * 100)}%
                        </span>
                        <span className="stat-bar stat-bar-timing">
                          <span style={{ width: `${Math.round(state.aggregate.timingAccuracy * 100)}%` }} />
                        </span>
                      </div>
                    )}
                    {handBalance && (
                      <div className="stat">
                        <span className="stat-label">Balance</span>
                        <span className="stat-value">
                          L {Math.round(handBalance.leftAvgVelocity)} · R {Math.round(handBalance.rightAvgVelocity)}
                        </span>
                        <span className="stat-bar stat-bar-balance">
                          <span className="stat-bar-balance-left" style={{ width: `${leftBalancePct}%` }} />
                          <span className="stat-bar-balance-right" style={{ width: `${100 - leftBalancePct}%` }} />
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="result-footer">
                    {sectionStatus && <div className={`stamp stamp-${sectionStatus}`}>{SECTION_STATUS_LABEL[sectionStatus]}</div>}
                    <p className="tally">
                      {state.aggregate.correct}/{state.aggregate.expected} notes · {state.aggregate.missed} missed ·{' '}
                      {state.aggregate.extra} wrong
                      {mode === 'metronome' && (
                        <>
                          {' '}
                          · {state.aggregate.onTime} on / {state.aggregate.early} early / {state.aggregate.late} late
                        </>
                      )}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

/** One stable settings object per distinct value, so the engine's sync effect only fires on a real change — `range` arrives as a fresh object more often than its measures actually change. */
function useMemoSettings(range: MeasureRange, tempoBpm: number, handFilter: HandFilter, mode: PracticeMode): AttemptSettings {
  const { startMeasure, endMeasure } = range
  return useMemo(
    () => ({ range: { startMeasure, endMeasure }, tempoBpm, handFilter, mode }),
    [startMeasure, endMeasure, tempoBpm, handFilter, mode],
  )
}

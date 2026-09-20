import { useEffect, useRef, useState } from 'react'
import { TempoControl } from './TempoControl'

/**
 * The tempo the piece is being worked up to, in the app header alongside
 * the title and composer — because that's what it is: a property of the
 * piece, saved with it, not a per-session setting. It's also the bar the
 * score's per-measure shading judges "ready" against, so raising it
 * deliberately un-greens the measures that were only cleared at the old
 * tempo (see `clearedAtTarget` in lib/coach/pieceProgress.ts).
 *
 * Chip-opens-a-panel rather than inline, matching InputSourceSelector next
 * to it: the full control (number field, slider, presets) is far too much
 * to sit in a header, but the current tempo alone reads fine as a chip.
 */
export function TargetTempoChip({
  tempoBpm,
  presets,
  disabled,
  onChange,
}: {
  tempoBpm: number
  presets?: number[]
  /** True while an attempt is running — the tempo can't change underneath a take in progress. */
  disabled?: boolean
  onChange: (bpm: number) => void
}) {
  const [requestedOpen, setRequestedOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  // Derived rather than closed via an effect on `disabled`: the panel is
  // open when an attempt starts if that's where the student set the tempo
  // they wanted, and leaving a dead control on screen mid-take reads as
  // broken. Deriving also reopens it when the attempt ends, which is where
  // they left it.
  const open = requestedOpen && !disabled

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setRequestedOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRequestedOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="tempo-chip-wrap" ref={wrapperRef}>
      <button
        type="button"
        className="input-chip"
        aria-expanded={open}
        aria-label={`Target tempo: ${tempoBpm} bpm`}
        title="The tempo you're working this piece up to"
        disabled={disabled}
        onClick={() => setRequestedOpen((isOpen) => !isOpen)}
      >
        <span className="input-chip-icon" aria-hidden="true">
          ♩
        </span>
        <span className="input-chip-label">{tempoBpm}</span>
      </button>

      {open && (
        <div className="input-panel tempo-panel">
          <div className="tempo-panel-label">Working up to</div>
          <TempoControl tempoBpm={tempoBpm} onChange={onChange} presets={presets} />
        </div>
      )}
    </div>
  )
}

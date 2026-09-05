import { NumberField } from '../NumberField/NumberField'

const MIN_BPM = 20
const MAX_BPM = 240

export function TempoControl({
  tempoBpm,
  onChange,
  disabled,
  presets,
}: {
  tempoBpm: number
  onChange: (bpm: number) => void
  disabled?: boolean
  /** Quick-select tempos (e.g. 1/3, 2/3, full speed) shown as buttons alongside the number field. */
  presets?: number[]
}) {
  return (
    <div className="tempo-control">
      <div className="tempo-readout">
        <NumberField value={tempoBpm} min={MIN_BPM} max={MAX_BPM} disabled={disabled} onCommit={onChange} />
        <span className="tempo-unit">bpm</span>
      </div>
      <input
        type="range"
        className="tempo-slider"
        aria-label="Tempo"
        min={MIN_BPM}
        max={MAX_BPM}
        value={tempoBpm}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {presets && presets.length > 1 && (
        <div className="tempo-presets">
          {presets.map((bpm) => (
            <button
              key={bpm}
              type="button"
              className={`tempo-preset-btn${bpm === tempoBpm ? ' tempo-preset-btn-active' : ''}`}
              disabled={disabled}
              onClick={() => onChange(bpm)}
            >
              {bpm}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

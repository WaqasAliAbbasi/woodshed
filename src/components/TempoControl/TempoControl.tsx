import { NumberField } from '../NumberField/NumberField'

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
      <label>
        Tempo (BPM)
        <NumberField value={tempoBpm} min={20} max={240} disabled={disabled} onCommit={onChange} />
      </label>
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

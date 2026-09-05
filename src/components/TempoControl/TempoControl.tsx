import { NumberField } from '../NumberField/NumberField'

export function TempoControl({
  tempoBpm,
  onChange,
  disabled,
}: {
  tempoBpm: number
  onChange: (bpm: number) => void
  disabled?: boolean
}) {
  return (
    <label className="tempo-control">
      Tempo (BPM)
      <NumberField value={tempoBpm} min={20} max={240} disabled={disabled} onCommit={onChange} />
    </label>
  )
}

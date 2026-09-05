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
      <input
        type="number"
        min={20}
        max={240}
        value={tempoBpm}
        disabled={disabled}
        onChange={(e) => onChange(Math.min(Math.max(Number(e.target.value) || 20, 20), 240))}
      />
    </label>
  )
}

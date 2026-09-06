import type { PracticeMode } from '../../lib/scoring/types'

const OPTIONS: { value: PracticeMode; label: string }[] = [
  { value: 'metronome', label: 'Metronome' },
  { value: 'notes', label: 'Notes' },
]

export function PracticeModeControl({
  mode,
  onChange,
  disabled,
}: {
  mode: PracticeMode
  onChange: (mode: PracticeMode) => void
  disabled?: boolean
}) {
  return (
    <fieldset className="hand-filter-control practice-mode-control" disabled={disabled}>
      <legend>Mode</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className="hand-filter-option">
          <input
            type="radio"
            name="practice-mode"
            checked={mode === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  )
}

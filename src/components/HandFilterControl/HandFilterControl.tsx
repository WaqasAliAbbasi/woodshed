import type { HandFilter } from '../../lib/musicxml/buildExpectedTimeline'

const OPTIONS: { value: HandFilter; label: string }[] = [
  { value: 'left', label: 'Left hand' },
  { value: 'both', label: 'Both hands' },
  { value: 'right', label: 'Right hand' },
]

export function HandFilterControl({
  handFilter,
  onChange,
  disabled,
}: {
  handFilter: HandFilter
  onChange: (handFilter: HandFilter) => void
  disabled?: boolean
}) {
  return (
    <fieldset className="hand-filter-control" disabled={disabled}>
      <legend>Hands</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className="hand-filter-option">
          <input
            type="radio"
            name="hand-filter"
            checked={handFilter === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  )
}

import type { HandFilter } from '../../lib/musicxml/buildExpectedTimeline'

// Abbreviated because this sits in the fixed bottom deck, where width is
// scarce — the full wording stays on each option's aria-label rather than
// being dropped.
const OPTIONS: { value: HandFilter; label: string; name: string }[] = [
  { value: 'left', label: 'L', name: 'Left hand' },
  { value: 'both', label: 'Both', name: 'Both hands' },
  { value: 'right', label: 'R', name: 'Right hand' },
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
      {/* The group still needs a name for screen readers; it's only the
          visible "Hands" text that the deck has no room for. */}
      <legend className="sr-only">Hands</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className="hand-filter-option" title={option.name}>
          <input
            type="radio"
            name="hand-filter"
            aria-label={option.name}
            checked={handFilter === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  )
}

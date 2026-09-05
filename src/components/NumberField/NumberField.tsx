import { useState } from 'react'

/**
 * A numeric text input that stays freely typable while focused and only
 * clamps to [min, max] when the value is committed (blur or Enter).
 *
 * Clamping on every keystroke instead makes typing impossible: intermediate
 * values like the leading "1" of "120" fail the bounds check and get
 * rewritten under the user's cursor, so the only usable input method left
 * is the spinner arrows.
 */
export function NumberField({
  value,
  min,
  max,
  onCommit,
  disabled,
}: {
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
  disabled?: boolean
}) {
  // Non-null only while the input is being edited; the committed `value`
  // prop is what's displayed whenever no edit is in progress.
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    setDraft(null)
    const parsed = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(parsed)) {
      onCommit(Math.min(Math.max(parsed, min), max))
    }
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft ?? String(value)}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(null)
        }
      }}
    />
  )
}

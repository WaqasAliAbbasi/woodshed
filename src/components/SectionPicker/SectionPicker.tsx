import type { MeasureRange } from '../../lib/musicxml/types'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function SectionPicker({
  measureCount,
  range,
  onChange,
  disabled,
}: {
  measureCount: number
  range: MeasureRange
  onChange: (range: MeasureRange) => void
  disabled?: boolean
}) {
  return (
    <div className="section-picker">
      <label>
        From measure
        <input
          type="number"
          min={1}
          max={measureCount}
          value={range.startMeasure}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...range, startMeasure: clamp(Number(e.target.value) || 1, 1, range.endMeasure) })
          }
        />
      </label>
      <label>
        To measure
        <input
          type="number"
          min={range.startMeasure}
          max={measureCount}
          value={range.endMeasure}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...range, endMeasure: clamp(Number(e.target.value) || range.startMeasure, range.startMeasure, measureCount) })
          }
        />
      </label>
      <span className="section-picker-hint">of {measureCount} measures</span>
    </div>
  )
}

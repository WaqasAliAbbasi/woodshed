import type { Collection } from '../../lib/db/pathRepo'
import { shortCollectionName } from '../Path/links'

/** Everything / one chip per collection (`Sessions` and `Stats` artboards). `value` is a collection id, or undefined for everything. */
export function CollectionFilter({ collections, value, onChange }: { collections: Collection[]; value: string | undefined; onChange: (id: string | undefined) => void }) {
  if (collections.length === 0) return null
  return (
    <div role="group" aria-label="Filter by collection" className="p-chips">
      <button type="button" aria-pressed={value === undefined} onClick={() => onChange(undefined)}>
        Everything
      </button>
      {collections.map((c) => (
        <button key={c.id} type="button" aria-pressed={value === c.id} onClick={() => onChange(c.id)}>
          {shortCollectionName(c)}
        </button>
      ))}
    </div>
  )
}

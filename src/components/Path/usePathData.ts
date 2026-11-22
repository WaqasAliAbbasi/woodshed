import { useCallback, useEffect, useMemo, useState } from 'react'
import { getPathOverview, type PathOverview } from '../../lib/db/pathRepo'
import { deriveState, type DerivedState } from '../../lib/path/deriveState'

/**
 * Loads `/api/path/overview` and derives every path and the plan input
 * from it. Recomputed from scratch on every load (and on `reload`), never
 * cached across screens — "plans are recomputed from current state each
 * time" (docs/learning-path.md).
 */
export function usePathData(): {
  overview: PathOverview | undefined
  derived: DerivedState | undefined
  error: string | undefined
  reload: () => Promise<void>
} {
  const [loaded, setLoaded] = useState<{ overview: PathOverview; at: number } | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  const reload = useCallback(async () => {
    try {
      const overview = await getPathOverview()
      setLoaded({ overview, at: Date.now() })
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    getPathOverview(controller.signal)
      .then((overview) => setLoaded({ overview, at: Date.now() }))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err))
      })
    return () => controller.abort()
  }, [])

  // "Now" is when the data arrived, not every render.
  const derived = useMemo(() => (loaded ? deriveState(loaded.overview, loaded.at) : undefined), [loaded])
  return { overview: loaded?.overview, derived, error, reload }
}

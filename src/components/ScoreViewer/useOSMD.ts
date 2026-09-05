import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useEffect, useRef, useState } from 'react'
import { loadScore } from '../../lib/musicxml/loadScore'

export interface UseOSMDResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  osmd: OpenSheetMusicDisplay | undefined
  error: string | undefined
}

export function useOSMD(musicXml: string): UseOSMDResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [osmd, setOsmd] = useState<OpenSheetMusicDisplay | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''

    loadScore(container, musicXml, controller.signal)
      .then(({ osmd: loaded }) => {
        setOsmd(loaded)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      controller.abort()
      // Covers the real case of switching pieces — see loadScore's `signal`
      // doc comment for why aborting alone isn't enough during the load.
      container.innerHTML = ''
    }
  }, [musicXml])

  return { containerRef, osmd, error }
}

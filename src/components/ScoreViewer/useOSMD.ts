import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useEffect, useRef, useState } from 'react'
import { loadScore } from '../../lib/musicxml/loadScore'
import { getDefaultMusicColor, watchColorScheme } from '../../lib/theme'

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

  // OSMD paints its default note color once at load time (see loadScore),
  // so it doesn't react on its own if the OS/browser theme flips while a
  // piece is already open — re-apply and redraw so the score doesn't get
  // stuck in the wrong theme's color.
  useEffect(() => {
    if (!osmd) return
    return watchColorScheme(() => {
      osmd.setOptions({ defaultColorMusic: getDefaultMusicColor() })
      osmd.render()
    })
  }, [osmd])

  return { containerRef, osmd, error }
}

import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadScore } from '../../lib/musicxml/loadScore'
import { getDefaultMusicColor, watchColorScheme } from '../../lib/theme'

const ZOOM_STORAGE_KEY = 'woodshed:score-zoom'
export const MIN_ZOOM = 0.6
export const MAX_ZOOM = 1.8
const DEFAULT_ZOOM = 1

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

function loadPersistedZoom(): number {
  const raw = localStorage.getItem(ZOOM_STORAGE_KEY)
  const parsed = raw === null ? NaN : Number(raw)
  return Number.isFinite(parsed) ? clampZoom(parsed) : DEFAULT_ZOOM
}

export interface UseOSMDResult {
  containerRef: React.RefObject<HTMLDivElement | null>
  osmd: OpenSheetMusicDisplay | undefined
  error: string | undefined
  zoom: number
  setZoom: (zoom: number) => void
  /**
   * Bumped every time osmd re-renders for any reason (zoom, container
   * resize, theme change). A re-render replaces every GraphicalNote
   * instance, so anything that cached graphical notes from a previous
   * render (the progress heatmap, the selected-range highlight) needs to
   * redo that work — depend on this in a `useEffect` to know when to.
   */
  renderVersion: number
}

export function useOSMD(musicXml: string): UseOSMDResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [osmd, setOsmd] = useState<OpenSheetMusicDisplay | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [zoom, setZoomState] = useState(loadPersistedZoom)
  const [renderVersion, setRenderVersion] = useState(0)
  // Read through a ref (rather than closing over `zoom` directly) so the
  // mount effect below doesn't need `zoom` in its dependency array — it
  // should only ever run once per `musicXml`, not re-run (and reload the
  // whole score) every time the zoom control is used.
  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])
  /** The zoom already baked into the current osmd's most recent render — lets the zoom-change effect skip re-rendering right after load, when it's already current. */
  const lastAppliedZoomRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''

    loadScore(container, musicXml, controller.signal, zoomRef.current)
      .then(({ osmd: loaded }) => {
        lastAppliedZoomRef.current = zoomRef.current
        setOsmd(loaded)
        setRenderVersion((v) => v + 1)
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

  // Re-render at the new zoom level whenever it changes (but not right after
  // load, when the just-loaded render already used it — see lastAppliedZoomRef).
  useEffect(() => {
    if (!osmd) return
    if (lastAppliedZoomRef.current === zoom) return
    // oxlint-disable-next-line react/immutability -- osmd is a mutable imperative instance (like a video/map element), not plain render state; this is OSMD's actual API for setting zoom.
    osmd.Zoom = zoom
    osmd.render()
    lastAppliedZoomRef.current = zoom
    setRenderVersion((v) => v + 1)
  }, [osmd, zoom])

  // OSMD lays out its SVG once against whatever the container width was at
  // render time and never reflows on its own (autoResize is off — see
  // loadScore). Watch the container itself rather than `window.resize` so
  // this also catches layout-only width changes (e.g. a sidebar toggling)
  // and not just viewport resizes. Skips the width-unchanged case so it
  // doesn't force a render on ResizeObserver's mandatory first callback.
  useEffect(() => {
    if (!osmd) return
    const container = containerRef.current
    if (!container) return

    let lastWidth = container.getBoundingClientRect().width
    let frame: number | undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width === undefined || Math.abs(width - lastWidth) < 1) return
      lastWidth = width
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        osmd.render()
        setRenderVersion((v) => v + 1)
      })
    })
    observer.observe(container)
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [osmd])

  // OSMD paints its default note color once at load time (see loadScore),
  // so it doesn't react on its own if the OS/browser theme flips while a
  // piece is already open — re-apply and redraw so the score doesn't get
  // stuck in the wrong theme's color.
  useEffect(() => {
    if (!osmd) return
    return watchColorScheme(() => {
      osmd.setOptions({ defaultColorMusic: getDefaultMusicColor() })
      osmd.render()
      setRenderVersion((v) => v + 1)
    })
  }, [osmd])

  const setZoom = useCallback((next: number) => {
    const clamped = clampZoom(next)
    localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped))
    setZoomState(clamped)
  }, [])

  return { containerRef, osmd, error, zoom, setZoom, renderVersion }
}

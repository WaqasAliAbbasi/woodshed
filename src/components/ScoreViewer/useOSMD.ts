import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { useCallback, useEffect, useRef, useState } from 'react'
import { applyDrawRange, fitZoom, rangeKey } from '../../lib/musicxml/drawRange'
import { loadScore } from '../../lib/musicxml/loadScore'
import type { MeasureRange } from '../../lib/musicxml/types'
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
  /** The focus range the score currently shows (see `rangeKey`), undefined for the whole score — it lags `focus` while frozen. */
  drawnFocusKey: string | undefined
}

/**
 * `frozen` holds off every re-render until it lifts, and then applies one.
 * It's on for the whole of an attempt (see ScoreViewer's prop of the same
 * name). Two reasons, in order: re-laying the music out under someone
 * mid-performance is the wrong thing to do to a player regardless of what it
 * costs technically; and a render repaints every notehead from the score's
 * own colors, wiping the green/red the attempt has painted so far.
 *
 * Checked against OSMD rather than assumed, since the obvious worry turns
 * out to be unfounded: it keeps the same GraphicalNote instances across a
 * render and `setColor` on one cached before it still paints the live score
 * afterwards, so a re-render loses the coloring already done but not the
 * ability to go on coloring. The cursor keeps its position and visibility
 * too. Scoring itself never depended on the render either way — the matchers
 * work off MIDI, not the DOM.
 */
/**
 * `focus`, when set, draws only those measures, zoomed to fill the
 * container's width (see drawRange.ts) — the stored zoom is ignored, and
 * moving the focus re-renders (held off while frozen, like everything else).
 */
export function useOSMD(musicXml: string, frozen: boolean, focus?: MeasureRange): UseOSMDResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const [osmd, setOsmd] = useState<OpenSheetMusicDisplay | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [zoom, setZoomState] = useState(loadPersistedZoom)
  const [renderVersion, setRenderVersion] = useState(0)
  const [drawnFocusKey, setDrawnFocusKey] = useState<string | undefined>(undefined)
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
  const focusRef = useRef(focus)
  useEffect(() => {
    focusRef.current = focus
  })
  /** The focus baked into the most recent render, as "start-end" — so a new range re-renders but the same one doesn't. */
  const lastAppliedFocusRef = useRef<string | undefined>(undefined)
  const focusKey = rangeKey(focus)
  /** The zoom to render at: the stored one, or — when focused — whatever fills the width. */
  const effectiveZoom = useCallback(() => {
    const f = focusRef.current
    const width = containerRef.current?.getBoundingClientRect().width ?? 0
    return f ? fitZoom(f.endMeasure - f.startMeasure + 1, width) : zoomRef.current
  }, [])
  /** Set when `frozen` swallowed a re-render, so the reason for it (a resize, a theme flip) isn't lost — one render catches all of them up once it lifts. */
  const pendingRenderRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()

    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''

    const initialZoom = effectiveZoom()
    const initialFocusKey = rangeKey(focusRef.current)
    lastAppliedFocusRef.current = initialFocusKey
    loadScore(container, musicXml, controller.signal, initialZoom, (loaded) => applyDrawRange(loaded, focusRef.current))
      .then(({ osmd: loaded }) => {
        lastAppliedZoomRef.current = initialZoom
        setOsmd(loaded)
        setDrawnFocusKey(initialFocusKey)
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
    // effectiveZoom is stable (it reads refs), so this still runs once per score.
  }, [musicXml, effectiveZoom])

  // The single place a re-render actually happens — every trigger below goes
  // through it, so they all report the new renderVersion and all pick up the
  // current zoom (a resize that re-rendered at a stale zoom would undo one
  // deferred while frozen).
  const render = useCallback(() => {
    if (!osmd) return
    const f = focusRef.current
    applyDrawRange(osmd, f)
    lastAppliedFocusRef.current = rangeKey(f)
    const nextZoom = effectiveZoom()
    // oxlint-disable-next-line react/immutability -- osmd is a mutable imperative instance (like a video/map element), not plain render state; this is OSMD's actual API for setting zoom.
    osmd.Zoom = nextZoom
    osmd.render()
    lastAppliedZoomRef.current = nextZoom
    pendingRenderRef.current = false
    setDrawnFocusKey(rangeKey(f))
    setRenderVersion((v) => v + 1)
  }, [osmd, effectiveZoom])

  // A new focus range re-renders (not right after load, which already drew it).
  useEffect(() => {
    if (!osmd || lastAppliedFocusRef.current === focusKey) return
    if (frozen) {
      pendingRenderRef.current = true
      return
    }
    // oxlint-disable-next-line react/set-state-in-effect -- same as the zoom effect below: syncing osmd, the external system.
    render()
  }, [osmd, focusKey, frozen, render])

  // Re-render at the new zoom level whenever it changes (but not right after
  // load, when the just-loaded render already used it — see lastAppliedZoomRef).
  useEffect(() => {
    if (!osmd) return
    // Focused, the zoom is fitted to the width — the stored one doesn't apply.
    if (focusRef.current) return
    if (lastAppliedZoomRef.current === zoom) return
    if (frozen) {
      pendingRenderRef.current = true
      return
    }
    // oxlint-disable-next-line react/set-state-in-effect -- osmd is the external system this effect exists to synchronize with; the state `render` sets is renderVersion, which is the notification that it did, not a value derivable during render.
    render()
  }, [osmd, zoom, frozen, render])

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
      if (frozen) {
        pendingRenderRef.current = true
        return
      }
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(render)
    })
    observer.observe(container)
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [osmd, frozen, render])

  // OSMD paints its default note color once at load time (see loadScore),
  // so it doesn't react on its own if the OS/browser theme flips while a
  // piece is already open — re-apply and redraw so the score doesn't get
  // stuck in the wrong theme's color.
  useEffect(() => {
    if (!osmd) return
    return watchColorScheme(() => {
      osmd.setOptions({ defaultColorMusic: getDefaultMusicColor() })
      if (frozen) {
        pendingRenderRef.current = true
        return
      }
      render()
    })
  }, [osmd, frozen, render])

  // Whatever was held off during the attempt lands the moment it ends, so a
  // zoom or resize made mid-attempt isn't silently dropped — it just waits.
  // (A zoom change is already handled by its own effect re-running here,
  // which clears the flag before this sees it — hence no double render.)
  useEffect(() => {
    if (frozen || !pendingRenderRef.current) return
    render()
  }, [frozen, render])

  const setZoom = useCallback((next: number) => {
    const clamped = clampZoom(next)
    localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped))
    setZoomState(clamped)
  }, [])

  return { containerRef, osmd, error, zoom, setZoom, renderVersion, drawnFocusKey }
}

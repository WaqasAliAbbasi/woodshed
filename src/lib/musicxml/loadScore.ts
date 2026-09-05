import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { getDefaultMusicColor } from '../theme'

export interface LoadedScore {
  osmd: OpenSheetMusicDisplay
  measureCount: number
}

/**
 * Instantiates OSMD against `container`, parses `musicXml`, and renders it.
 * `osmd.cursor` is only initialized during `render()` (it needs the
 * GraphicalMusicSheet built from layout, not just the parsed logical model
 * from `load()`), so render() is required even for callers that only need
 * the cursor/timeline and don't care about the drawn output.
 *
 * `signal` lets a caller abort before `render()` runs. This matters because
 * OSMD has no dispose/cancel of its own: `load()` is async, and in React
 * StrictMode's dev-mode double-effect-invoke (mount, cleanup, mount again),
 * a "stale" first call can still be mid-`load()` when a second one starts
 * against the same container. Without checking the signal, the stale call's
 * `render()` still fires after the fresh one's, and OSMD's `render()` never
 * clears the container first — it just draws its own SVG into it — so both
 * copies end up stacked in the DOM.
 */
export async function loadScore(container: HTMLElement, musicXml: string, signal?: AbortSignal): Promise<LoadedScore> {
  const osmd = new OpenSheetMusicDisplay(container, {
    autoResize: false,
    backend: 'svg',
    drawingParameters: 'compacttight',
    // OSMD defaults to solid black for every musical element (noteheads,
    // stems, clefs, barlines, ...), which is invisible against a dark page
    // background — match whatever the app's current theme actually is.
    defaultColorMusic: getDefaultMusicColor(),
  })
  await osmd.load(musicXml)
  if (signal?.aborted) {
    throw new DOMException('loadScore aborted', 'AbortError')
  }
  osmd.render()
  const measureCount = osmd.Sheet.SourceMeasures.length
  return { osmd, measureCount }
}

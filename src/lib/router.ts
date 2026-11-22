import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * Just enough client-side routing for real URLs — "Copy the link to open on
 * your laptop" needs one — on the History API, without a router dependency.
 * The server's SPA fallback (server/static.ts) serves index.html for any
 * path, and Vite does the same in dev.
 */

const CHANGE = 'woodshed:navigate'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(CHANGE, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(CHANGE, onChange)
  }
}

const snapshot = () => window.location.pathname + window.location.search

export interface Route {
  path: string
  search: URLSearchParams
}

export function useRoute(): Route {
  const location = useSyncExternalStore(subscribe, snapshot, () => '/')
  const [path, query = ''] = location.split('?')
  return { path, search: new URLSearchParams(query) }
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.scrollTo(0, 0)
  window.dispatchEvent(new Event(CHANGE))
}

/** `/piece/:id/play` against `/piece/abc/play` → `{ id: 'abc' }`, or undefined if it doesn't match. */
export function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const a = pattern.split('/')
  const b = path.replace(/\/$/, '').split('/')
  if (a.length !== b.length) return undefined
  const params: Record<string, string> = {}
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i])
    else if (a[i] !== b[i]) return undefined
  }
  return params
}

/** Below this width the practice screens give way to the bigger-screen page (docs/learning-path.md, "Devices"). */
export const PHONE_MAX_WIDTH = 699

export function useIsPhone(): boolean {
  const query = `(max-width: ${PHONE_MAX_WIDTH}px)`
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setIsPhone(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return isPhone
}

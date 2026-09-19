/**
 * Thin fetch wrapper for the `/api/*` backend (see `server/`). Every repo
 * module (`piecesRepo.ts`, `sectionsRepo.ts`, `attemptsRepo.ts`) goes through
 * this instead of calling `fetch` directly, so the 401→redirect-to-login
 * behavior and JSON error handling live in exactly one place.
 */

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * A 401 means the session cookie is missing or expired — bounce to the
 * server-rendered login page rather than surfacing a confusing in-app error.
 * `next` round-trips the current path so login lands back where the user was.
 * Guarded against redirect loops if `/login` itself is ever fetched through
 * this client (it isn't today, but cheap insurance).
 */
function redirectToLogin(): void {
  if (typeof window === 'undefined') return
  if (window.location.pathname.startsWith('/login')) return
  const next = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.href = `/login?next=${next}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (res.status === 401) {
    redirectToLogin()
    throw new ApiError('Not authenticated', 401)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let message = body
    try {
      const parsed: unknown = JSON.parse(body)
      if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string') {
        message = parsed.error
      }
    } catch {
      // Not JSON — use the raw body text as the message.
    }
    throw new ApiError(message || res.statusText, res.status)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { signal })
}

export function apiPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body), signal })
}

export function apiPatch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body), signal })
}

export function apiDelete(path: string, signal?: AbortSignal): Promise<void> {
  return request<void>(path, { method: 'DELETE', signal })
}

/** 404 is a normal, expected outcome for the `get*` repo functions (they return `undefined`) — not every other error. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404
}

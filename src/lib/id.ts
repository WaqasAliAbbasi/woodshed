/**
 * `crypto.randomUUID()` only exists in secure contexts (HTTPS or
 * `localhost`) — Safari in particular enforces this strictly. Since this
 * app is meant to be opened from other devices on the local network (an
 * iPad hitting the dev machine's LAN address, say), that's a plain-HTTP,
 * non-localhost origin where `crypto.randomUUID` is simply undefined.
 * Falls back to a non-cryptographic id that's still unique enough for
 * this app's purposes (local records keyed by insertion, not a security
 * boundary).
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

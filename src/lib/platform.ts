/**
 * iPadOS Safari reports its platform as `MacIntel` (desktop-Safari
 * masquerading, since iPad's UA string dropped "iPad" years ago) — the
 * `maxTouchPoints` check is what actually distinguishes a real Mac from an
 * iPad in that case.
 */
export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

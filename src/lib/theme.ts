/** Shared note-feedback colors — live per-note scoring (PracticeSession) and the piece-progress heatmap (ScoreViewer) both use these so "green" means the same thing everywhere in the app. */
export const CORRECT_COLOR = '#22c55e'
export const PROGRESSING_COLOR = '#f59e0b'
export const WRONG_COLOR = '#ef4444'

/**
 * OSMD paints note/stem/clef colors once at render time rather than
 * inheriting CSS, so it needs the current theme's text color handed to it
 * explicitly. Reads index.css's `--text` custom property (already
 * light/dark-resolved via its own `prefers-color-scheme` media query) so
 * there's a single source of truth for "what does default text look like
 * right now" instead of a second hardcoded light/dark color pair here.
 * Falls back to black for non-browser environments (e.g. unit tests, which
 * don't load index.css) where getComputedStyle has nothing to resolve.
 */
export function getDefaultMusicColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#000'
}

/** Calls `onChange` whenever the OS/browser light-dark preference flips while subscribed. Returns an unsubscribe function. */
export function watchColorScheme(onChange: () => void): () => void {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', onChange)
  return () => mediaQuery.removeEventListener('change', onChange)
}

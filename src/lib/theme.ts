/** Shared note-feedback colors — live per-note scoring (PracticeSession) and the piece-progress heatmap (ScoreViewer) both use these so "green" means the same thing everywhere in the app. */
export const CORRECT_COLOR = '#5b7f52'
export const PROGRESSING_COLOR = '#b8792e'
export const WRONG_COLOR = '#a6472e'

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

/** Same rationale as {@link getDefaultMusicColor}: OSMD paints once at render time, so the current range-selection highlight needs the resolved `--accent` handed in explicitly rather than inherited via CSS. */
export function getAccentColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b8792e'
}

/** Calls `onChange` whenever the OS/browser light-dark preference flips while subscribed. Returns an unsubscribe function. */
export function watchColorScheme(onChange: () => void): () => void {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', onChange)
  return () => mediaQuery.removeEventListener('change', onChange)
}

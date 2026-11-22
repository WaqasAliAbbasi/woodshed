/**
 * Reads a book folder picked with `<input webkitdirectory>` (docs/learning-path.md,
 * "Collections"): every subfolder named `NNN - Title` is one piece on page
 * NNN, scored by the `.musicxml` or `.mxl` inside it, with an optional
 * `metadata.json` whose `bpms[0]` is its target tempo.
 */
export interface BookEntry {
  page: number
  title: string
  /** Relative path (as `webkitRelativePath` gives it) of the score file. */
  scorePath: string
  metadataPath?: string
}

const FOLDER = /^(\d+)\s*-\s*(.+)$/

/** "Mexican Hat Dance [214564]" → "Mexican Hat Dance": a trailing catalogue id in brackets isn't part of the title. */
export function cleanTitle(folderTitle: string): string {
  return folderTitle.replace(/\s*\[[^\]]*\]\s*$/, '').trim() || folderTitle.trim()
}

export function readBookFolder(paths: string[]): { bookName: string | undefined; entries: BookEntry[] } {
  const byFolder = new Map<string, { score?: string; metadata?: string }>()
  let bookName: string | undefined
  for (const path of paths) {
    const parts = path.split('/')
    if (parts.length < 3 || parts.some((p) => p.startsWith('.'))) continue
    bookName ??= parts[0]
    const folder = parts[parts.length - 2]
    const file = parts[parts.length - 1].toLowerCase()
    const slot = byFolder.get(folder) ?? {}
    if ((file.endsWith('.musicxml') || file.endsWith('.mxl')) && (!slot.score || file.endsWith('.musicxml'))) slot.score = path
    if (file === 'metadata.json') slot.metadata = path
    byFolder.set(folder, slot)
  }
  const entries: BookEntry[] = []
  for (const [folder, slot] of byFolder) {
    const match = folder.match(FOLDER)
    if (!match || !slot.score) continue
    entries.push({ page: Number(match[1]), title: cleanTitle(match[2]), scorePath: slot.score, metadataPath: slot.metadata })
  }
  entries.sort((a, b) => a.page - b.page)
  return { bookName, entries }
}

/** `bpms[0]` from a metadata.json, if it's a sensible whole tempo. */
export function targetFromMetadata(json: string): number | undefined {
  try {
    const bpm = (JSON.parse(json) as { bpms?: unknown }).bpms
    const first = Array.isArray(bpm) ? bpm[0] : undefined
    return typeof first === 'number' && first >= 20 && first <= 240 ? Math.round(first) : undefined
  } catch {
    return undefined
  }
}

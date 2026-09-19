export interface PieceMetadata {
  title?: string
  composer?: string
}

/** Decodes the handful of XML entities a title/composer string can legally contain. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

/**
 * Cheap regex scrape of a raw MusicXML string for title/composer, done
 * before OSMD parses it (so import doesn't need to wait on a full render
 * just to get metadata). `<work-title>` is the "proper" MusicXML title tag,
 * but many real-world exports (e.g. MuseScore) only emit `<movement-title>`
 * — checked second, as a fallback, since `<work-title>` is more likely to
 * hold the actual piece title when both are present.
 */
export function parseMusicXmlMetadata(musicXml: string): PieceMetadata {
  const titleMatch = musicXml.match(/<work-title>([^<]*)<\/work-title>/) ?? musicXml.match(/<movement-title>([^<]*)<\/movement-title>/)
  const composerMatch =
    musicXml.match(/<creator type="composer">([^<]*)<\/creator>/) ?? musicXml.match(/<creator>([^<]*)<\/creator>/)

  return {
    title: titleMatch?.[1] ? decodeXmlEntities(titleMatch[1]).trim() || undefined : undefined,
    composer: composerMatch?.[1] ? decodeXmlEntities(composerMatch[1]).trim() || undefined : undefined,
  }
}

export interface PieceMetadata {
  title?: string
  composer?: string
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
    title: titleMatch?.[1]?.trim() || undefined,
    composer: composerMatch?.[1]?.trim() || undefined,
  }
}

import JSZip from 'jszip'

/**
 * Decompresses a .mxl (compressed MusicXML) archive into its plain
 * MusicXML text. Per the MusicXML spec, the archive should contain a
 * META-INF/container.xml naming the actual root file; many real-world
 * exporters (including some versions of MuseScore) omit it and just
 * include a single XML file at the top level, so that's the fallback.
 */
export async function decompressMxl(data: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(data)

  const containerXml = await zip.file('META-INF/container.xml')?.async('text')
  const rootPath = containerXml?.match(/<rootfile[^>]*full-path="([^"]+)"/)?.[1]
  const rootFile = rootPath ? zip.file(rootPath) : undefined
  if (rootFile) return rootFile.async('text')

  const xmlEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !entry.name.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(entry.name),
  )
  if (xmlEntries.length === 0) {
    throw new Error('No MusicXML file found inside the .mxl archive.')
  }
  return xmlEntries[0].async('text')
}

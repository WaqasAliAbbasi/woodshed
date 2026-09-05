import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decompressMxl } from './loadMxl'

const fixtureDir = resolve(__dirname, './__fixtures__')
const originalXml = readFileSync(resolve(fixtureDir, 'clementi-sonatina.musicxml'), 'utf-8')

function readAsArrayBuffer(path: string): ArrayBuffer {
  // Copy into a fresh Uint8Array rather than slicing Node's Buffer.buffer
  // directly — under vitest's jsdom environment the two can be ArrayBuffer
  // instances from different realms, which JSZip's type check rejects.
  return new Uint8Array(readFileSync(path)).buffer
}

describe('decompressMxl', () => {
  it('extracts the root file named by META-INF/container.xml', async () => {
    const data = readAsArrayBuffer(resolve(fixtureDir, 'clementi-sonatina-with-container.mxl'))
    const xml = await decompressMxl(data)
    expect(xml).toBe(originalXml)
  })

  it('falls back to the single top-level XML file when there is no META-INF/container.xml', async () => {
    const data = readAsArrayBuffer(resolve(fixtureDir, 'clementi-sonatina-naked.mxl'))
    const xml = await decompressMxl(data)
    expect(xml).toBe(originalXml)
  })

  it('throws a clear error when the archive contains no MusicXML file', async () => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('readme.txt', 'not a score')
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(decompressMxl(buffer)).rejects.toThrow(/No MusicXML file found/)
  })
})

import { describe, expect, it } from 'vitest'
import { parseMusicXmlMetadata } from './parseMetadata'

describe('parseMusicXmlMetadata', () => {
  it('reads title from <work-title>', () => {
    const xml = '<score-partwise><work><work-title>Sonatina</work-title></work></score-partwise>'
    expect(parseMusicXmlMetadata(xml).title).toBe('Sonatina')
  })

  it('falls back to <movement-title> when <work-title> is absent', () => {
    const xml = '<score-partwise><movement-title>Down in the Valley</movement-title></score-partwise>'
    expect(parseMusicXmlMetadata(xml).title).toBe('Down in the Valley')
  })

  it('prefers <work-title> over <movement-title> when both are present', () => {
    const xml =
      '<score-partwise><work><work-title>Real Title</work-title></work><movement-title>Ignored</movement-title></score-partwise>'
    expect(parseMusicXmlMetadata(xml).title).toBe('Real Title')
  })

  it('reads composer from <creator type="composer">', () => {
    const xml = '<score-partwise><identification><creator type="composer">Muzio Clementi</creator></identification></score-partwise>'
    expect(parseMusicXmlMetadata(xml).composer).toBe('Muzio Clementi')
  })

  it('falls back to a plain <creator> with no type when a composer-typed one is absent', () => {
    const xml = '<score-partwise><identification><creator>Anonymous</creator></identification></score-partwise>'
    expect(parseMusicXmlMetadata(xml).composer).toBe('Anonymous')
  })

  it('returns undefined title and composer when neither is present', () => {
    const xml = '<score-partwise></score-partwise>'
    expect(parseMusicXmlMetadata(xml)).toEqual({ title: undefined, composer: undefined })
  })

  it('trims whitespace around the matched text', () => {
    const xml = '<score-partwise><work><work-title>  Padded  </work-title></work></score-partwise>'
    expect(parseMusicXmlMetadata(xml).title).toBe('Padded')
  })
})

import { describe, expect, it } from 'vitest'
import { cleanTitle, readBookFolder, targetFromMetadata } from './folderImport'

describe('readBookFolder', () => {
  it('takes one page-ordered piece per "NNN - Title" subfolder', () => {
    const { bookName, entries } = readBookFolder([
      'Book 2/032 - Mexican Hat Dance [214564]/Mexican Hat Dance [214564].musicxml',
      'Book 2/032 - Mexican Hat Dance [214564]/Mexican Hat Dance [214564].mid',
      'Book 2/032 - Mexican Hat Dance [214564]/metadata.json',
      'Book 2/004 - Down in the Valley/Down in the Valley.mxl',
      'Book 2/.DS_Store',
      'Book 2/notes/readme.txt',
      'Book 2/010 - No score here/metadata.json',
    ])
    expect(bookName).toBe('Book 2')
    expect(entries).toEqual([
      { page: 4, title: 'Down in the Valley', scorePath: 'Book 2/004 - Down in the Valley/Down in the Valley.mxl', metadataPath: undefined },
      {
        page: 32,
        title: 'Mexican Hat Dance',
        scorePath: 'Book 2/032 - Mexican Hat Dance [214564]/Mexican Hat Dance [214564].musicxml',
        metadataPath: 'Book 2/032 - Mexican Hat Dance [214564]/metadata.json',
      },
    ])
  })

  it('prefers .musicxml when a folder has both', () => {
    const { entries } = readBookFolder(['B/001 - A/a.mxl', 'B/001 - A/a.musicxml'])
    expect(entries[0].scorePath).toBe('B/001 - A/a.musicxml')
  })
})

describe('helpers', () => {
  it('strips a trailing catalogue id from a title', () => {
    expect(cleanTitle('Mexican Hat Dance [214564]')).toBe('Mexican Hat Dance')
    expect(cleanTitle("You're In My Heart")).toBe("You're In My Heart")
  })

  it('reads the target tempo from bpms[0]', () => {
    expect(targetFromMetadata('{"bpms":[100]}')).toBe(100)
    expect(targetFromMetadata('{"bpms":[]}')).toBeUndefined()
    expect(targetFromMetadata('not json')).toBeUndefined()
  })
})

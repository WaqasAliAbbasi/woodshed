import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InputSourceSelector } from './InputSourceSelector'
import { useMidiInput } from './useMidiInput'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function render(element: React.ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return { container, root }
}

// jsdom has no navigator.requestMIDIAccess, so useMidiInput() naturally reports
// unsupported here — no mocking needed to hit the "Web MIDI isn't supported" banner.
function Harness() {
  const midi = useMidiInput()
  return <InputSourceSelector midi={midi} />
}

function setUserAgent(value: string): void {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true })
}

/** Everything but the chip's own label lives behind a click now. */
function openPanel(container: HTMLDivElement): void {
  const chip = container.querySelector<HTMLButtonElement>('button.input-chip')
  expect(chip).not.toBeNull()
  act(() => chip!.click())
}

describe('InputSourceSelector', () => {
  const originalUserAgent = navigator.userAgent

  afterEach(() => {
    setUserAgent(originalUserAgent)
    Reflect.deleteProperty(navigator, 'share')
  })

  it('collapses to a chip naming the current input source, with nothing else on screen', async () => {
    const { container } = render(<Harness />)
    await act(async () => {})

    // jsdom reports no Web MIDI, so the keyboard is the active source.
    const chip = container.querySelector('button.input-chip')
    expect(chip?.textContent).toContain('Input: Computer')
    expect(chip?.getAttribute('aria-label')).toBe('Input: Computer keyboard')
    expect(container.querySelector('.input-panel')).toBeNull()
    expect(container.querySelector('.keyboard-legend')).toBeNull()
    expect(container.textContent).not.toMatch(/Use Chrome, Edge, or Firefox/)

    // Opening it gets you the mapping in one line; the full 18-key map stays
    // folded away until asked for.
    openPanel(container)
    expect(container.querySelector('.input-panel-note')?.textContent).toMatch(/white keys C4–F5/)
    const keyMap = container.querySelector<HTMLDetailsElement>('details.key-map')
    expect(keyMap?.open).toBe(false)
    expect(keyMap?.querySelector('.keyboard-legend')).not.toBeNull()
  })

  it('closes the panel on Escape', async () => {
    const { container } = render(<Harness />)
    await act(async () => {})
    openPanel(container)
    expect(container.querySelector('.input-panel')).not.toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('.input-panel')).toBeNull()
  })

  it('suggests desktop browsers when Web MIDI is unsupported on a non-iOS device', async () => {
    const { container } = render(<Harness />)
    await act(async () => {})
    openPanel(container)
    expect(container.textContent).toMatch(/Use Chrome, Edge, or Firefox 108\+/)
    expect(container.textContent).not.toContain('MIDIWeb Browser')
  })

  it('links to MIDIWeb Browser when Web MIDI is unsupported on iOS', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')

    const { container } = render(<Harness />)
    await act(async () => {})
    openPanel(container)
    expect(container.textContent).toContain('MIDIWeb Browser')
    const link = container.querySelector<HTMLAnchorElement>('a[href*="midiweb-browser"]')
    expect(link).not.toBeNull()
    expect(link?.target).toBe('_blank')
  })

  it('omits the share button when the Web Share API is unavailable (jsdom has no navigator.share)', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')

    const { container } = render(<Harness />)
    await act(async () => {})
    openPanel(container)
    expect(container.textContent).toContain('open this page there')
    expect(container.querySelector('button.share-page')).toBeNull()
  })

  it('shares the current page URL when the Share button is clicked', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })

    const { container } = render(<Harness />)
    await act(async () => {})
    openPanel(container)
    expect(container.textContent).toContain('share this page into it')

    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Share this page')
    expect(button).toBeDefined()
    await act(async () => {
      button!.click()
    })

    expect(share).toHaveBeenCalledWith({ url: window.location.href, title: document.title })
  })
})

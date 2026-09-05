import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { NumberField } from './NumberField'
import { TempoControl } from '../TempoControl/TempoControl'

// React requires this flag to avoid "not configured to support act(...)" warnings.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!

function render(element: React.ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(element))
  return { container, root }
}

function input(container: HTMLDivElement, index = 0): HTMLInputElement {
  const el = container.querySelectorAll<HTMLInputElement>('input')[index]
  expect(el).toBeDefined()
  return el
}

function focus(el: HTMLElement): void {
  act(() => el.focus())
}

function blur(el: HTMLElement): void {
  act(() => el.blur())
}

/** Types the full accumulated text, exactly as a real keystroke sequence does. */
function typeInto(el: HTMLInputElement, text: string): void {
  act(() => {
    setNativeValue!.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function pressKey(el: HTMLInputElement, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
}

/**
 * Mirrors real usage: the parent owns the value and only re-renders with it
 * once NumberField commits — so the input's display after blur shows the
 * committed value. Records every commit for assertions.
 */
function createNumberFieldHarness(initial: number, min: number, max: number) {
  const committed: number[] = []
  function Harness() {
    const [value, setValue] = useState(initial)
    return (
      <NumberField
        value={value}
        min={min}
        max={max}
        onCommit={(next) => {
          committed.push(next)
          setValue(next)
        }}
      />
    )
  }
  return { Harness, committed }
}

describe('NumberField', () => {
  it('keeps intermediate keystrokes as typed instead of clamping them', () => {
    const { Harness, committed } = createNumberFieldHarness(80, 20, 240)
    const { container } = render(<Harness />)
    const el = input(container)

    focus(el)
    typeInto(el, '') // select-all + delete
    expect(el.value).toBe('')
    typeInto(el, '1') // below min — must NOT snap to 20 under the cursor
    expect(el.value).toBe('1')
    typeInto(el, '12')
    expect(el.value).toBe('12')
    typeInto(el, '120')
    expect(el.value).toBe('120')
    expect(committed).toEqual([]) // nothing committed until blur

    blur(el)
    expect(committed).toEqual([120])
    expect(el.value).toBe('120')
  })

  it('clamps on commit, not while typing', () => {
    const { Harness, committed } = createNumberFieldHarness(80, 20, 240)
    const { container } = render(<Harness />)
    const el = input(container)

    focus(el)
    typeInto(el, '300')
    expect(el.value).toBe('300')
    blur(el)
    expect(committed).toEqual([240])

    focus(el)
    typeInto(el, '5')
    blur(el)
    expect(committed).toEqual([240, 20])
  })

  it('reverts to the current value when left empty or non-numeric', () => {
    const { Harness, committed } = createNumberFieldHarness(80, 20, 240)
    const { container } = render(<Harness />)
    const el = input(container)

    focus(el)
    typeInto(el, '')
    blur(el)
    expect(committed).toEqual([])
    expect(el.value).toBe('80')

    focus(el)
    typeInto(el, '12e') // invalid for <input type="number"> — sanitizes to ""
    blur(el)
    expect(committed).toEqual([])
    expect(el.value).toBe('80')
  })

  it('commits on Enter', () => {
    const { Harness, committed } = createNumberFieldHarness(80, 20, 240)
    const { container } = render(<Harness />)
    const el = input(container)

    focus(el)
    typeInto(el, '60')
    pressKey(el, 'Enter')
    expect(committed).toEqual([60])
    expect(el.value).toBe('60')
  })

  it('reverts on Escape without committing', () => {
    const { Harness, committed } = createNumberFieldHarness(80, 20, 240)
    const { container } = render(<Harness />)
    const el = input(container)

    focus(el)
    typeInto(el, '9')
    pressKey(el, 'Escape')
    expect(committed).toEqual([])
    expect(el.value).toBe('80')
  })

  it('follows external value changes while not being edited', () => {
    const committed: number[] = []
    const { container, root } = render(<NumberField value={80} min={20} max={240} onCommit={committed.push.bind(committed)} />)
    const el = input(container)

    act(() => root.render(<NumberField value={100} min={20} max={240} onCommit={committed.push.bind(committed)} />))
    expect(el.value).toBe('100')
  })
})

describe('TempoControl typing', () => {
  it('lets the user type a multi-digit tempo that passes through an out-of-range prefix', () => {
    const committed: number[] = []
    function Example() {
      const [tempo, setTempo] = useState(80)
      return (
        <TempoControl
          tempoBpm={tempo}
          onChange={(bpm) => {
            committed.push(bpm)
            setTempo(bpm)
          }}
        />
      )
    }
    const { container } = render(<Example />)
    const el = input(container)

    focus(el)
    typeInto(el, '')
    typeInto(el, '1')
    expect(el.value).toBe('1')
    typeInto(el, '12')
    typeInto(el, '120')
    blur(el)

    expect(committed).toEqual([120])
    expect(el.value).toBe('120')
  })
})

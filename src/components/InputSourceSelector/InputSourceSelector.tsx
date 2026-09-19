import { useEffect, useRef, useState } from 'react'
import { KEY_TO_NOTE, midiNoteToName } from '../../lib/midi/virtualKeyboard'
import { isIOS } from '../../lib/platform'
import type { UseMidiInputResult } from './useMidiInput'

const MIDIWEB_BROWSER_URL = 'https://apps.apple.com/hk/app/midiweb-browser/id6757226617'

/**
 * MIDIWeb Browser documents no custom URL scheme for other pages to open a
 * URL directly inside it — the only thing that reliably lands it in iOS's
 * share sheet is the standard Web Share API (the same mechanism as tapping
 * Safari's own Share button). This can't pre-select MIDIWeb Browser for the
 * user (no web API exposes that); it just raises the OS sheet they'd
 * otherwise have to find themselves, with MIDIWeb Browser as one of the options.
 */
function shareCurrentPage(): void {
  navigator.share({ url: window.location.href, title: document.title }).catch(() => {})
}

function KeyboardLegend() {
  return (
    <div className="keyboard-legend">
      {Object.entries(KEY_TO_NOTE).map(([key, note]) => (
        <span key={key} className="keyboard-key">
          <span>{key.toUpperCase()}</span>
          <span className="keyboard-key-note">{midiNoteToName(note)}</span>
        </span>
      ))}
    </div>
  )
}

/**
 * What the collapsed chip says about the current input source. It stays two
 * words wide whatever happens: `warn` (every state where something has to be
 * done before a MIDI device will play) colors it and `detail` explains it on
 * hover, while the actual fix lives in the panel a click away.
 */
function chipStatus(midi: UseMidiInputResult): { icon: string; label: string; detail?: string; warn: boolean } {
  // Named "Input: …" rather than just "Computer"/"MIDI": on its own neither
  // word says what the chip is *for*, and "Keyboard" would read as the
  // instrument in a piano app rather than the thing you type on.
  if (midi.keyboardEnabled) return { icon: '⌨️', label: 'Input: Computer', detail: 'Computer keyboard', warn: false }
  const midiChip = { icon: '🎹', label: 'Input: MIDI' }
  if (midi.connectError) return { ...midiChip, detail: midi.connectError, warn: true }
  if (midi.deviceLost) return { ...midiChip, detail: 'MIDI device disconnected', warn: true }
  if (!midi.midiConnected) return { ...midiChip, detail: 'Not connected yet', warn: true }
  if (midi.devices.length === 0) return { ...midiChip, detail: 'No MIDI devices found', warn: true }
  const selected = midi.devices.find((device) => device.id === midi.selectedDeviceId)
  return { ...midiChip, detail: selected?.name, warn: false }
}

/**
 * The input source is a device-level setting — it changes when a keyboard
 * gets plugged in or the browser changes, not from one piece to the next —
 * so it collapses to a chip in the app header, and the things you only need
 * once (device list, key mapping, the iOS help) open on demand behind it.
 * All the chip itself keeps on screen is which of the two sources is live and
 * whether it's working — the rest is a click away (see chipStatus).
 *
 * The computer keyboard is always offered (so the app stays usable where Web
 * MIDI isn't), real MIDI devices only where supported — and this is still
 * the natural home for a future polyphonic-listening (mic) option.
 */
export function InputSourceSelector({ midi }: { midi: UseMidiInputResult }) {
  const midiSelected = !midi.keyboardEnabled
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const status = chipStatus(midi)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="input-chip-wrap" ref={wrapperRef}>
      <button
        type="button"
        className={`input-chip${status.warn ? ' input-chip-warn' : ''}`}
        aria-expanded={open}
        aria-label={`Input: ${status.detail ?? status.label}`}
        title={status.detail}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span className="input-chip-icon" aria-hidden="true">
          {status.icon}
        </span>
        <span className="input-chip-label">{status.label}</span>
      </button>

      {open && (
        <div className="input-panel">
          {midi.supported ? (
            <fieldset className="input-source-list">
              <legend className="input-source-label">Input</legend>

              <label className="input-source">
                <input
                  type="radio"
                  name="input-source"
                  checked={midi.keyboardEnabled}
                  onChange={() => midi.setKeyboardEnabled(true)}
                />
                <span>Computer keyboard</span>
              </label>

              <label className="input-source">
                <input
                  type="radio"
                  name="input-source"
                  checked={midiSelected}
                  onChange={() => {
                    midi.setKeyboardEnabled(false)
                    if (!midi.midiConnected) void midi.connect()
                  }}
                />
                <span>MIDI device</span>
              </label>
            </fieldset>
          ) : (
            // Nothing to choose between with no Web MIDI: the keyboard is the
            // only source, so the panel is just the explanation for that.
            <p className="input-panel-heading">Input · computer keyboard</p>
          )}

          {!midi.supported && (
            <p className="practice-hint">
              No Web MIDI here — using the computer keyboard.{' '}
              {isIOS() ? (
                <>
                  Install{' '}
                  <a href={MIDIWEB_BROWSER_URL} target="_blank" rel="noopener noreferrer">
                    MIDIWeb Browser
                  </a>{' '}
                  and {typeof navigator.share === 'function' ? 'share this page into it' : 'open this page there'} for a
                  MIDI device.
                  {typeof navigator.share === 'function' && (
                    <>
                      {' '}
                      <button type="button" className="share-page" onClick={shareCurrentPage}>
                        Share this page
                      </button>
                    </>
                  )}
                </>
              ) : (
                'Use Chrome, Edge, or Firefox 108+ to play with a MIDI device.'
              )}
            </p>
          )}

          {midi.keyboardEnabled && (
            <>
              <p className="input-panel-note">
                <b>A</b>–<b>'</b> play the white keys C4–F5, <b>W</b>–<b>P</b> the black ones between them. That's
                right-hand range — a left-hand part needs a real MIDI keyboard.
              </p>
              {/* The full map is a reference you need once, not every session. */}
              <details className="key-map">
                <summary>Key map</summary>
                <KeyboardLegend />
              </details>
            </>
          )}

          {midiSelected && midi.supported && (
            <>
              {!midi.midiConnected && (
                <button type="button" onClick={() => void midi.connect()}>
                  Connect MIDI Device
                </button>
              )}

              {midi.midiConnected && midi.devices.length === 0 && (
                <div className="banner banner-warning">No MIDI devices found. Plug in a keyboard and it should appear here.</div>
              )}

              {midi.midiConnected && midi.devices.length > 0 && (
                <select value={midi.selectedDeviceId ?? ''} onChange={(e) => midi.selectDevice(e.target.value)}>
                  {midi.devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </select>
              )}

              {midi.connectError && <div className="banner banner-error">{midi.connectError}</div>}
              {midi.deviceLost && (
                <div className="banner banner-error">MIDI device disconnected. Reconnect it or choose another.</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

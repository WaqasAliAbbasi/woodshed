import { KEY_TO_NOTE, midiNoteToName } from '../../lib/midi/virtualKeyboard'
import type { UseMidiInputResult } from './useMidiInput'

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
 * Lists the available input sources in one place. The computer keyboard is
 * always available (so the app stays usable where Web MIDI isn't), real MIDI
 * devices only when supported — and this is the natural home for a future
 * polyphonic-listening (mic) option.
 */
export function InputSourceSelector({ midi }: { midi: UseMidiInputResult }) {
  const midiSelected = !midi.keyboardEnabled

  return (
    <div className="midi-selector panel">
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

        {midi.supported && (
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
        )}
      </fieldset>

      {!midi.supported && (
        <div className="banner banner-warning">
          Web MIDI isn't supported in this browser — computer keyboard input only. Use Chrome, Edge, or Firefox 108+
          to play with a MIDI device.
        </div>
      )}

      {midi.keyboardEnabled && <KeyboardLegend />}

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
  )
}
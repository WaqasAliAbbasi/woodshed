import type { UseMidiInputResult } from './useMidiInput'

export function MidiDeviceSelector({ midi }: { midi: UseMidiInputResult }) {
  if (!midi.supported) {
    return (
      <div className="banner banner-error">
        Web MIDI isn't supported in this browser. Use Chrome, Edge, or Firefox 108+ — Safari doesn't support it.
      </div>
    )
  }

  return (
    <div className="midi-selector">
      {!midi.connected && (
        <button type="button" onClick={() => void midi.connect()}>
          Connect MIDI Device
        </button>
      )}

      {midi.connected && midi.devices.length === 0 && (
        <div className="banner banner-warning">No MIDI devices found. Plug in a keyboard and it should appear here.</div>
      )}

      {midi.connected && midi.devices.length > 0 && (
        <select value={midi.selectedDeviceId ?? ''} onChange={(e) => midi.selectDevice(e.target.value)}>
          {midi.devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
      )}

      {midi.connectError && <div className="banner banner-error">{midi.connectError}</div>}
      {midi.deviceLost && <div className="banner banner-error">MIDI device disconnected. Reconnect it or choose another.</div>}
    </div>
  )
}

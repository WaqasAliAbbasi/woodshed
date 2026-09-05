export interface MidiDeviceInfo {
  id: string
  name: string
  manufacturer: string
}

export function isWebMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
}

/** Must be called from within a user gesture handler (e.g. a button click) for a clean permission prompt. */
export async function requestMidiAccess(): Promise<MIDIAccess> {
  if (!isWebMidiSupported()) {
    throw new Error(
      'Web MIDI is not supported in this browser. Use Chrome, Edge, or Firefox 108+ — Safari does not support it.',
    )
  }
  return navigator.requestMIDIAccess({ sysex: false })
}

export function listInputDevices(access: MIDIAccess): MidiDeviceInfo[] {
  return Array.from(access.inputs.values()).map((input) => ({
    id: input.id,
    name: input.name ?? 'Unknown device',
    manufacturer: input.manufacturer ?? '',
  }))
}

export function findInputById(access: MIDIAccess, id: string): MIDIInput | undefined {
  return access.inputs.get(id)
}

/**
 * Attaches `handler` to `input`'s message stream and returns a cleanup
 * function. Only one input should be attached at a time — attaching to
 * multiple simultaneously connected devices would double-process events.
 */
export function attachInputHandler(input: MIDIInput, handler: (event: MIDIMessageEvent) => void): () => void {
  input.onmidimessage = handler
  return () => {
    input.onmidimessage = null
  }
}

/**
 * Watches for devices connecting/disconnecting. If the currently selected
 * device (`selectedId`) disconnects, `onSelectedDeviceLost` fires so the UI
 * can surface a warning immediately rather than silently losing input.
 */
export function watchDeviceChanges(
  access: MIDIAccess,
  selectedId: string | undefined,
  onChange: (devices: MidiDeviceInfo[]) => void,
  onSelectedDeviceLost: () => void,
): () => void {
  const handler = (event: MIDIConnectionEvent) => {
    onChange(listInputDevices(access))
    const port = event.port
    if (port && port.id === selectedId && port.state === 'disconnected') {
      onSelectedDeviceLost()
    }
  }
  access.onstatechange = handler
  return () => {
    access.onstatechange = null
  }
}

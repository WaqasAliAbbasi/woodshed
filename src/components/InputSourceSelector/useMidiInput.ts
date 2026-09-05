import { useCallback, useEffect, useRef, useState } from 'react'
import {
  attachInputHandler,
  findInputById,
  isWebMidiSupported,
  listInputDevices,
  requestMidiAccess,
  watchDeviceChanges,
  type MidiDeviceInfo,
} from '../../lib/midi/midiAccess'
import { parseMidiMessage, type MidiNoteEvent } from '../../lib/midi/midiEvents'
import { KEYBOARD_VELOCITY, KEY_TO_NOTE, keyToNote } from '../../lib/midi/virtualKeyboard'

const LAST_DEVICE_KEY = 'woodshed:lastMidiDeviceId'

export interface UseMidiInputResult {
  supported: boolean
  /** True when any input source (real MIDI device or the computer keyboard) is available. */
  connected: boolean
  /** True only when a real MIDI device is connected (keyboard input excluded). */
  midiConnected: boolean
  devices: MidiDeviceInfo[]
  selectedDeviceId: string | undefined
  deviceLost: boolean
  connect: () => Promise<void>
  connectError: string | undefined
  selectDevice: (id: string) => void
  /** When true, the computer keyboard plays the piano instead of a MIDI device. */
  keyboardEnabled: boolean
  setKeyboardEnabled: (on: boolean) => void
  /** Swaps which callback receives raw note events. Callers should set this to a no-op on unmount/deactivation. */
  setNoteHandler: (handler: (event: MidiNoteEvent) => void) => void
}

/**
 * Owns the MIDI device connection lifecycle (device list, selection,
 * hot-plug detection) independently of who currently wants to *consume*
 * note events — `setNoteHandler` lets the active practice session attach
 * without this hook needing to know about practice state at all.
 */
export function useMidiInput(): UseMidiInputResult {
  const [connected, setConnected] = useState(false)
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(
    () => localStorage.getItem(LAST_DEVICE_KEY) ?? undefined,
  )
  const [deviceLost, setDeviceLost] = useState(false)
  const [connectError, setConnectError] = useState<string | undefined>(undefined)
  // Default to the keyboard when Web MIDI isn't supported, so there's always
  // a usable, selected input source rather than nothing checked and Start disabled.
  const [keyboardEnabled, setKeyboardEnabled] = useState(() => !isWebMidiSupported())

  const accessRef = useRef<MIDIAccess | undefined>(undefined)
  const noteHandlerRef = useRef<(event: MidiNoteEvent) => void>(() => {})

  const connect = useCallback(async () => {
    try {
      const access = await requestMidiAccess()
      accessRef.current = access
      setConnectError(undefined)
      const list = listInputDevices(access)
      setDevices(list)
      setSelectedDeviceId((current) => (current && list.some((d) => d.id === current) ? current : list[0]?.id))
      setConnected(true)
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const selectDevice = useCallback((id: string) => {
    setSelectedDeviceId(id)
    setDeviceLost(false)
    localStorage.setItem(LAST_DEVICE_KEY, id)
  }, [])

  const setNoteHandler = useCallback((handler: (event: MidiNoteEvent) => void) => {
    noteHandlerRef.current = handler
  }, [])

  // Attach the raw note source: the computer keyboard when keyboard mode is
  // on, otherwise whichever MIDI device is selected.
  useEffect(() => {
    if (keyboardEnabled) {
      const noteOn = (e: KeyboardEvent) => {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
        const note = keyToNote(e.key)
        if (note === undefined) return
        noteHandlerRef.current({ type: 'noteOn', note, velocity: KEYBOARD_VELOCITY, timeStampMs: performance.now() })
      }
      const noteOff = (e: KeyboardEvent) => {
        const note = keyToNote(e.key)
        if (note === undefined) return
        noteHandlerRef.current({ type: 'noteOff', note, velocity: 0, timeStampMs: performance.now() })
      }
      // Drop any still-held notes if the window loses focus mid-attempt.
      const releaseAll = () => {
        for (const note of Object.values(KEY_TO_NOTE)) {
          noteHandlerRef.current({ type: 'noteOff', note, velocity: 0, timeStampMs: performance.now() })
        }
      }
      window.addEventListener('keydown', noteOn)
      window.addEventListener('keyup', noteOff)
      window.addEventListener('blur', releaseAll)
      return () => {
        releaseAll()
        window.removeEventListener('keydown', noteOn)
        window.removeEventListener('keyup', noteOff)
        window.removeEventListener('blur', releaseAll)
      }
    }

    const access = accessRef.current
    if (!access || !selectedDeviceId) return
    const input = findInputById(access, selectedDeviceId)
    if (!input) return
    return attachInputHandler(input, (event) => {
      if (!event.data) return
      const parsed = parseMidiMessage(event.data, event.timeStamp)
      if (parsed) noteHandlerRef.current(parsed)
    })
  }, [keyboardEnabled, selectedDeviceId, connected])

  // Watch for the selected device disconnecting, and keep the device list fresh.
  useEffect(() => {
    const access = accessRef.current
    if (!access) return
    return watchDeviceChanges(
      access,
      selectedDeviceId,
      (updated) => setDevices(updated),
      () => setDeviceLost(true),
    )
  }, [selectedDeviceId, connected])

  return {
    supported: isWebMidiSupported(),
    connected: connected || keyboardEnabled,
    midiConnected: connected,
    devices,
    selectedDeviceId,
    deviceLost,
    connect,
    connectError,
    selectDevice,
    keyboardEnabled,
    setKeyboardEnabled,
    setNoteHandler,
  }
}

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './VoiceSettingsModal.module.css'

interface Props {
  isMuted: boolean
  pttMode: boolean
  pttKey: string
  outputVolume: number
  onToggleMute: () => void
  onChangePttMode: (ptt: boolean) => void
  onChangePttKey: (code: string) => void
  onChangeOutputVolume: (vol: number) => void
  onSwitchInputDevice: (deviceId: string) => Promise<void>
  onSwitchOutputDevice: (deviceId: string) => Promise<void>
  onClose: () => void
}

export default function VoiceSettingsModal({
  isMuted, pttMode, pttKey, outputVolume,
  onToggleMute, onChangePttMode, onChangePttKey,
  onChangeOutputVolume, onSwitchInputDevice, onSwitchOutputDevice,
  onClose,
}: Props) {
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedInput, setSelectedInput] = useState('')
  const [selectedOutput, setSelectedOutput] = useState('')
  const [capturingKey, setCapturingKey] = useState(false)
  const [micTestActive, setMicTestActive] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const autoMutedRef = useRef(false)
  const stopMicTestRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      setInputDevices(devices.filter(d => d.kind === 'audioinput'))
      setOutputDevices(devices.filter(d => d.kind === 'audiooutput'))
    })
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (capturingKey) return
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, capturingKey])

  // Stop mic test on unmount
  useEffect(() => {
    return () => { stopMicTestRef.current?.() }
  }, [])

  function handleInputChange(deviceId: string) {
    setSelectedInput(deviceId)
    onSwitchInputDevice(deviceId)
  }

  function handleOutputChange(deviceId: string) {
    setSelectedOutput(deviceId)
    onSwitchOutputDevice(deviceId)
  }

  function startKeyCapture() {
    setCapturingKey(true)
    function capture(e: KeyboardEvent) {
      e.preventDefault()
      onChangePttKey(e.code)
      setCapturingKey(false)
      window.removeEventListener('keydown', capture, true)
    }
    window.addEventListener('keydown', capture, true)
  }

  async function startMicTest() {
    if (!isMuted) {
      autoMutedRef.current = true
      onToggleMute()
    } else {
      autoMutedRef.current = false
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedInput ? { deviceId: { exact: selectedInput } } : true,
      })
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)
      source.connect(ctx.destination)

      const data = new Uint8Array(analyser.frequencyBinCount)
      let rafId: number

      function animate() {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length
        setMicLevel(Math.min(avg / 80, 1))
        rafId = requestAnimationFrame(animate)
      }
      rafId = requestAnimationFrame(animate)

      stopMicTestRef.current = () => {
        cancelAnimationFrame(rafId)
        stream.getTracks().forEach(t => t.stop())
        ctx.close()
      }
      setMicTestActive(true)
    } catch {
      // Mic access failed — restore mute state
      if (autoMutedRef.current) {
        onToggleMute()
        autoMutedRef.current = false
      }
    }
  }

  function stopMicTest() {
    stopMicTestRef.current?.()
    stopMicTestRef.current = null
    setMicTestActive(false)
    setMicLevel(0)
    if (autoMutedRef.current) {
      onToggleMute()
      autoMutedRef.current = false
    }
  }

  function formatKeyCode(code: string) {
    return code
      .replace(/^Key/, '')
      .replace(/^Digit/, '')
      .replace('Space', 'SPACE')
      .replace('Backquote', '`')
      .replace('Backslash', '\\')
      .replace('BracketLeft', '[')
      .replace('BracketRight', ']')
      .replace('Semicolon', ';')
      .replace('Quote', "'")
      .replace('Comma', ',')
      .replace('Period', '.')
      .replace('Slash', '/')
      .replace('Minus', '-')
      .replace('Equal', '=')
  }

  const modal = (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>⚙ voice settings</span>
          <button type="button" className={styles.closeBtn} onClick={onClose}>[x]</button>
        </div>

        <section className={styles.section}>
          <div className={styles.sectionLabel}>devices</div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>input</span>
            <select
              className={styles.select}
              value={selectedInput}
              onChange={e => handleInputChange(e.target.value)}
            >
              <option value="">system default</option>
              {inputDevices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `microphone (${d.deviceId.slice(0, 8)})`}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>output</span>
            <select
              className={styles.select}
              value={selectedOutput}
              onChange={e => handleOutputChange(e.target.value)}
            >
              <option value="">system default</option>
              {outputDevices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `speaker (${d.deviceId.slice(0, 8)})`}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionLabel}>output volume</div>
          <div className={styles.sliderRow}>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={outputVolume}
              onChange={e => onChangeOutputVolume(parseFloat(e.target.value))}
              className={styles.slider}
            />
            <span className={styles.sliderValue}>{Math.round(outputVolume * 100)}%</span>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionLabel}>transmit mode</div>
          <div className={styles.radioGroup}>
            <label className={styles.radio}>
              <input
                type="radio"
                name="pttMode"
                checked={!pttMode}
                onChange={() => onChangePttMode(false)}
              />
              <span>voice activity</span>
            </label>
            <label className={styles.radio}>
              <input
                type="radio"
                name="pttMode"
                checked={pttMode}
                onChange={() => onChangePttMode(true)}
              />
              <span>push-to-talk</span>
            </label>
          </div>
          {pttMode && (
            <div className={styles.pttRow}>
              <span className={styles.fieldLabel}>key</span>
              <button
                type="button"
                className={`${styles.keyBtn} ${capturingKey ? styles.keyBtnCapturing : ''}`}
                onClick={startKeyCapture}
              >
                {capturingKey ? 'press a key...' : `[${formatKeyCode(pttKey)}]`}
              </button>
            </div>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionLabel}>mic test</div>
          <div className={styles.micTest}>
            <button
              type="button"
              className={micTestActive ? styles.stopBtn : ''}
              onClick={micTestActive ? stopMicTest : startMicTest}
            >
              {micTestActive ? '[stop]' : '[start]'}
            </button>
            <div className={styles.levelMeter}>
              <div className={styles.levelBar} style={{ width: `${micLevel * 100}%` }} />
            </div>
          </div>
          {micTestActive && (
            <span className={styles.testNote}>muted in channel while testing</span>
          )}
        </section>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

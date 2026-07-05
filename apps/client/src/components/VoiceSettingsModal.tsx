import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import styles from './VoiceSettingsModal.module.css'

interface Props {
  isMuted: boolean
  pttMode: boolean
  pttKey: string
  outputVolume: number
  selectedInput: string
  selectedOutput: string
  noiseSuppression: boolean
  echoCancellation: boolean
  autoGainControl: boolean
  rnnoiseEnabled: boolean
  rnnoiseSupported: boolean
  onToggleMute: () => void
  onChangePttMode: (ptt: boolean) => void
  onChangePttKey: (code: string) => void
  onChangeOutputVolume: (vol: number) => void
  onSwitchInputDevice: (deviceId: string) => Promise<void>
  onSwitchOutputDevice: (deviceId: string) => Promise<void>
  onChangeAudioProcessing: (ns: boolean, ec: boolean, agc: boolean) => void
  onChangeRnnoise: (enabled: boolean) => void
  onClose: () => void
}

const HISTORY_SAMPLES = 300 // ~5s at 60fps

export default function VoiceSettingsModal({
  isMuted, pttMode, pttKey, outputVolume,
  selectedInput, selectedOutput,
  noiseSuppression, echoCancellation, autoGainControl,
  rnnoiseEnabled, rnnoiseSupported,
  onToggleMute, onChangePttMode, onChangePttKey,
  onChangeOutputVolume, onSwitchInputDevice, onSwitchOutputDevice,
  onChangeAudioProcessing, onChangeRnnoise, onClose,
}: Props) {
  const trapRef = useFocusTrap<HTMLDivElement>()
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [capturingKey, setCapturingKey] = useState(false)
  const [micTestActive, setMicTestActive] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [micLevelAvg, setMicLevelAvg] = useState(0)
  const [testPlaybackVolume, setTestPlaybackVolume] = useState(0.5)
  const autoMutedRef = useRef(false)
  const stopMicTestRef = useRef<(() => void) | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const levelHistoryRef = useRef<number[]>([])

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
        audio: {
          ...(selectedInput ? { deviceId: { exact: selectedInput } } : {}),
          noiseSuppression,
          echoCancellation,
          autoGainControl,
        },
      })
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.05
      source.connect(analyser)

      const gainNode = ctx.createGain()
      gainNode.gain.value = testPlaybackVolume
      gainNodeRef.current = gainNode
      source.connect(gainNode)
      gainNode.connect(ctx.destination)

      const data = new Uint8Array(analyser.frequencyBinCount)
      levelHistoryRef.current = []
      let rafId: number

      function animate() {
        analyser.getByteFrequencyData(data)
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length
        const level = Math.min(avg / 80, 1)

        setMicLevel(level)

        levelHistoryRef.current.push(level)
        if (levelHistoryRef.current.length > HISTORY_SAMPLES) levelHistoryRef.current.shift()
        const histAvg = levelHistoryRef.current.reduce((s, v) => s + v, 0) / levelHistoryRef.current.length
        setMicLevelAvg(histAvg)

        rafId = requestAnimationFrame(animate)
      }
      rafId = requestAnimationFrame(animate)

      stopMicTestRef.current = () => {
        cancelAnimationFrame(rafId)
        stream.getTracks().forEach(t => t.stop())
        ctx.close()
        gainNodeRef.current = null
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
    setMicLevelAvg(0)
    levelHistoryRef.current = []
    if (autoMutedRef.current) {
      onToggleMute()
      autoMutedRef.current = false
    }
  }

  function handleTestVolumeChange(vol: number) {
    setTestPlaybackVolume(vol)
    if (gainNodeRef.current) gainNodeRef.current.gain.value = vol
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
      <div className={styles.modal} ref={trapRef} role="dialog" aria-modal="true" aria-label="voice settings">
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
              onChange={e => onSwitchInputDevice(e.target.value)}
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
              onChange={e => onSwitchOutputDevice(e.target.value)}
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
              style={{ '--val': outputVolume } as React.CSSProperties}
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
          <div className={styles.sectionLabel}>audio processing</div>
          <label className={styles.toggleRow}>
            <input type="checkbox" checked={noiseSuppression}
              onChange={e => onChangeAudioProcessing(e.target.checked, echoCancellation, autoGainControl)} />
            <span>noise suppression</span>
          </label>
          <label className={styles.toggleRow}>
            <input type="checkbox" checked={echoCancellation}
              onChange={e => onChangeAudioProcessing(noiseSuppression, e.target.checked, autoGainControl)} />
            <span>echo cancellation</span>
          </label>
          <label className={styles.toggleRow}>
            <input type="checkbox" checked={autoGainControl}
              onChange={e => onChangeAudioProcessing(noiseSuppression, echoCancellation, e.target.checked)} />
            <span>auto gain control</span>
          </label>
          {rnnoiseSupported && (
            <label className={styles.toggleRow}>
              <input type="checkbox" checked={rnnoiseEnabled}
                onChange={e => onChangeRnnoise(e.target.checked)} />
              <span>rnnoise suppression</span>
            </label>
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
              <div className={styles.levelBarAvg} style={{ width: `${micLevelAvg * 100}%` }} />
            </div>
          </div>
          <div className={styles.sliderRow}>
            <span className={styles.fieldLabel}>playback</span>
            <input
              type="range"
              min={0} max={1} step={0.01}
              value={testPlaybackVolume}
              onChange={e => handleTestVolumeChange(parseFloat(e.target.value))}
              className={styles.slider}
              style={{ '--val': testPlaybackVolume } as React.CSSProperties}
            />
            <span className={styles.sliderValue}>{Math.round(testPlaybackVolume * 100)}%</span>
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

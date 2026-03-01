import { NoiseSuppressionProcessor } from '@shiguredo/noise-suppression'

// Requires MediaStreamTrackProcessor / MediaStreamTrackGenerator (Insertable Streams API)
// Available in Chromium 94+ / WebView2 — not supported in Firefox or Safari
export const rnnoiseSupported = NoiseSuppressionProcessor.isSupported()

export class RNNoiseProcessor {
  name = 'rnnoise' as const
  processedTrack?: MediaStreamTrack
  private inner = new NoiseSuppressionProcessor()

  async init(opts: { track: MediaStreamTrack }): Promise<void> {
    this.processedTrack = await this.inner.startProcessing(opts.track)
  }

  async restart(opts: { track: MediaStreamTrack }): Promise<void> {
    this.inner.stopProcessing()
    this.processedTrack = await this.inner.startProcessing(opts.track)
  }

  async destroy(): Promise<void> {
    this.inner.stopProcessing()
    this.processedTrack = undefined
  }
}

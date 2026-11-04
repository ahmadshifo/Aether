/**
 * Publish an existing video-only MediaStream to MediaMTX over WHIP.
 * No camera or microphone is acquired here; the PWA already owns the camera.
 */
export class WhipPublisher {
  private pc: RTCPeerConnection | null = null
  private resourceUrl: string | null = null
  private readonly controller = new AbortController()
  private stopped = false

  async start(stream: MediaStream, whipUrl: string): Promise<void> {
    if (this.stopped) return
    const videoTrack = stream.getVideoTracks()[0]
    if (!videoTrack) throw new Error('No video track available')

    const pc = new RTCPeerConnection()
    this.pc = pc

    try {
      const sender = pc.addTrack(videoTrack, stream)
      // Prefer H.264 for the EchoSight media contract when the device supports it.
      const transceiver = pc.getTransceivers().find(item => item.sender === sender)
      const capabilities = RTCRtpSender.getCapabilities?.('video')
      if (transceiver && capabilities) {
        const h264 = capabilities.codecs.filter(codec => codec.mimeType.toLowerCase() === 'video/h264')
        if (h264.length) {
          transceiver.setCodecPreferences([
            ...h264,
            ...capabilities.codecs.filter(codec => codec.mimeType.toLowerCase() !== 'video/h264'),
          ])
        }
      }

      await pc.setLocalDescription(await pc.createOffer())
      await this.waitForIce(pc)
      if (this.stopped) return

      const response = await fetch(whipUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription?.sdp ?? '',
        signal: this.controller.signal,
      })
      if (response.status !== 201) {
        throw new Error(`WHIP returned HTTP ${response.status}`)
      }

      const location = response.headers.get('Location')
      if (location) this.resourceUrl = new URL(location, whipUrl).toString()
      const answer = await response.text()
      if (this.stopped) return
      await pc.setRemoteDescription({ type: 'answer', sdp: answer })
    } catch (error) {
      this.stop()
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
    }
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.controller.abort()
    this.pc?.close()
    this.pc = null
    if (this.resourceUrl) {
      const url = this.resourceUrl
      this.resourceUrl = null
      void fetch(url, { method: 'DELETE' }).catch(() => {})
    }
  }

  private async waitForIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return
    await new Promise<void>((resolve, reject) => {
      let timeout: number | undefined
      const done = (error?: Error) => {
        if (timeout !== undefined) window.clearTimeout(timeout)
        pc.removeEventListener('icegatheringstatechange', onChange)
        this.controller.signal.removeEventListener('abort', onAbort)
        if (error) reject(error)
        else resolve()
      }
      const onChange = () => {
        if (pc.iceGatheringState === 'complete') done()
      }
      const onAbort = () => done(new DOMException('Publish stopped', 'AbortError'))
      pc.addEventListener('icegatheringstatechange', onChange)
      this.controller.signal.addEventListener('abort', onAbort, { once: true })
      timeout = window.setTimeout(() => done(new Error('WebRTC ICE gathering timed out')), 12000)
      onChange()
    })
  }
}

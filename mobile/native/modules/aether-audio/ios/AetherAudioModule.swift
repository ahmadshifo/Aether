import ExpoModulesCore
import AVFoundation

// All audio uses RAM. The session controller owns foreground capture lifetime.
public class AetherAudioModule: Module {
  private var engine: AVAudioEngine?
  private var player: AVAudioPlayer?
  private var playbackTimer: Timer?
  private var playbackPromise: Promise?

  public func definition() -> ModuleDefinition {
    Name("AetherAudio")
    Events("audio", "captureError", "playbackStarted")
    AsyncFunction("prepare") { (promise: Promise) in
      AVAudioSession.sharedInstance().requestRecordPermission { granted in promise.resolve(granted) }
    }
    AsyncFunction("startCapture") { (promise: Promise) in
      do {
        self.stopCapture()
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
        let engine = AVAudioEngine()
        let input = engine.inputNode
        try input.setVoiceProcessingEnabled(true)
        let source = input.outputFormat(forBus: 0)
        guard source.sampleRate > 0,
              let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
              let converter = AVAudioConverter(from: source, to: target) else {
          promise.reject("audio_format", "Microphone format unavailable."); return
        }
        input.installTap(onBus: 0, bufferSize: 2048, format: source) { [weak self] buffer, _ in
          guard let self = self else { return }
          let capacity = AVAudioFrameCount(Double(buffer.frameLength) * 16000 / source.sampleRate + 16)
          guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
          var supplied = false
          var error: NSError?
          converter.convert(to: output, error: &error) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true; status.pointee = .haveData; return buffer
          }
          guard error == nil, let samples = output.int16ChannelData?[0], output.frameLength > 0 else { return }
          let count = Int(output.frameLength)
          var sum = 0.0
          for i in 0..<count { let value = Double(samples[i]) / 32768; sum += value * value }
          let data = Data(bytes: samples, count: count * 2)
          self.sendEvent("audio", ["pcm": data.base64EncodedString(), "rms": sqrt(sum / Double(count)), "samples": count])
        }
        self.engine = engine
        try engine.start()
        promise.resolve(nil)
      } catch {
        self.stopCapture()
        promise.reject("audio_capture", "Microphone could not start.")
      }
    }.runOnQueue(.main)
    AsyncFunction("stopCapture") { self.stopCapture() }.runOnQueue(.main)
    AsyncFunction("play") { (base64: String, rate: Double, promise: Promise) in
      self.stopPlayback()
      do {
        guard let data = Data(base64Encoded: base64), data.count <= 16 * 1024 * 1024 else {
          promise.reject("audio_data", "Invalid WAV response."); return
        }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
        let player = try AVAudioPlayer(data: data)
        player.enableRate = true
        player.rate = Float(max(0.5, min(1.55, rate)))
        self.player = player
        self.playbackPromise = promise
        guard player.play() else { throw NSError(domain: "audio", code: 1) }
        self.sendEvent("playbackStarted", [:])
        self.playbackTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
          guard let self = self else { return }
          if self.player?.isPlaying != true {
            self.playbackTimer?.invalidate(); self.playbackTimer = nil
            self.player = nil
            self.playbackPromise?.resolve("done"); self.playbackPromise = nil
          }
        }
      } catch {
        self.stopPlayback()
        promise.reject("audio_playback", "WAV playback could not start.")
      }
    }.runOnQueue(.main)
    AsyncFunction("stopPlayback") { self.stopPlayback() }.runOnQueue(.main)
    OnAppEntersBackground { self.stopCapture(); self.stopPlayback() }
    OnDestroy { self.stopCapture(); self.stopPlayback() }
  }

  private func stopCapture() {
    if let engine = engine { engine.inputNode.removeTap(onBus: 0); engine.stop() }
    engine = nil
  }
  private func stopPlayback() {
    playbackTimer?.invalidate(); playbackTimer = nil
    player?.stop(); player = nil
    playbackPromise?.resolve("cancelled"); playbackPromise = nil
  }
}

package expo.modules.aetheraudio

import android.Manifest
import android.content.pm.PackageManager
import android.media.*
import android.media.audiofx.AcousticEchoCanceler
import android.util.Base64
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread
import kotlin.math.sqrt

class AetherAudioModule : Module() {
  private val captureGeneration = AtomicLong()
  private val playGeneration = AtomicLong()
  @Volatile private var recorder: AudioRecord? = null
  @Volatile private var player: AudioTrack? = null
  private var echo: AcousticEchoCanceler? = null

  override fun definition() = ModuleDefinition {
    Name("AetherAudio")
    Events("audio", "captureError", "playbackStarted")
    AsyncFunction("prepare") {
      appContext.reactContext?.let { ContextCompat.checkSelfPermission(it, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED } ?: false
    }
    AsyncFunction("startCapture") {
      stopCapture()
      val minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      val record = AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16000,
        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minimum * 2, 6400))
      if (record.state != AudioRecord.STATE_INITIALIZED) { record.release(); throw IllegalStateException("audio_capture") }
      recorder = record
      if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(record.audioSessionId)?.also { it.enabled = true }
      record.startRecording()
      val generation = captureGeneration.get()
      thread(name = "Aether microphone") {
        val buffer = ShortArray(1600)
        try {
          while (captureGeneration.get() == generation) {
            val count = record.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
            if (count <= 0) break
            val bytes = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
            var energy = 0.0
            for (i in 0 until count) { bytes.putShort(buffer[i]); val value = buffer[i] / 32768.0; energy += value * value }
            if (captureGeneration.get() == generation) sendEvent("audio", mapOf(
              "pcm" to Base64.encodeToString(bytes.array(), Base64.NO_WRAP), "rms" to sqrt(energy / count), "samples" to count))
          }
        } catch (_: Exception) {
          if (captureGeneration.get() == generation) sendEvent("captureError", mapOf("code" to "audio-capture"))
        }
      }
    }
    AsyncFunction("stopCapture") { stopCapture() }
    AsyncFunction("stopPlayback") { stopPlayback() }
    AsyncFunction("play") { encoded: String, rate: Double, promise: Promise ->
      stopPlayback()
      val generation = playGeneration.get()
      thread(name = "Aether playback") {
        var track: AudioTrack? = null
        try {
          val wav = Base64.decode(encoded, Base64.DEFAULT)
          require(wav.size in 44..(16 * 1024 * 1024))
          val bytes = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
          require(String(wav, 0, 4, Charsets.US_ASCII) == "RIFF" && String(wav, 8, 4, Charsets.US_ASCII) == "WAVE")
          var offset = 12; var sampleRate = 0; var start = 0; var size = 0
          while (offset + 8 <= wav.size) {
            val id = String(wav, offset, 4, Charsets.US_ASCII)
            val length = bytes.getInt(offset + 4)
            require(length >= 0 && length <= wav.size - offset - 8)
            if (id == "fmt ") {
              require(length >= 16 && bytes.getShort(offset + 8).toInt() == 1 && bytes.getShort(offset + 10).toInt() == 1 && bytes.getShort(offset + 22).toInt() == 16)
              sampleRate = bytes.getInt(offset + 12)
            }
            if (id == "data") { start = offset + 8; size = length; break }
            offset += 8 + length + (length % 2)
          }
          require(sampleRate in 8000..48000 && size > 0)
          if (playGeneration.get() != generation) { promise.resolve("cancelled"); return@thread }
          track = AudioTrack.Builder().setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(sampleRate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
            .setBufferSizeInBytes(maxOf(8192, AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)))
            .setTransferMode(AudioTrack.MODE_STREAM).build()
          player = track
          track.playbackParams = PlaybackParams().setSpeed(rate.coerceIn(0.5, 1.55).toFloat())
          track.play()
          sendEvent("playbackStarted", emptyMap<String, Any>())
          var written = 0
          while (written < size && playGeneration.get() == generation) {
            val count = track.write(wav, start + written, minOf(4096, size - written), AudioTrack.WRITE_BLOCKING)
            if (count <= 0) throw IllegalStateException("audio_playback")
            written += count
          }
          while (playGeneration.get() == generation && track.playbackHeadPosition < size / 2) Thread.sleep(30)
          promise.resolve(if (playGeneration.get() == generation) "done" else "cancelled")
        } catch (_: Exception) {
          if (playGeneration.get() != generation) promise.resolve("cancelled") else promise.reject("audio_playback", "WAV playback failed.", null)
        } finally {
          if (player === track) player = null
          try { track?.release() } catch (_: Exception) { }
        }
      }
      Unit
    }
    OnActivityEntersBackground { stopCapture(); stopPlayback() }
    OnDestroy { stopCapture(); stopPlayback() }
  }

  private fun stopCapture() {
    captureGeneration.incrementAndGet()
    val old = recorder; recorder = null
    try { old?.stop() } catch (_: Exception) { }
    echo?.release(); echo = null
    old?.release()
  }
  private fun stopPlayback() {
    playGeneration.incrementAndGet()
    val old = player; player = null
    try { old?.pause(); old?.flush() } catch (_: Exception) { }
  }
}

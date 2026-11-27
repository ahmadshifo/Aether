"""Local inference. Only model weights are persisted; audio stays in RAM."""
import io
import os
import threading
import wave
import numpy as np

class VoiceError(Exception):
    def __init__(self, code, message, status=503):
        self.code, self.message, self.status = code, message, status

class LocalVoice:
    def __init__(self):
        self.role = os.getenv("VOICE_ROLE", "tts")
        self.model = None
        self.lock = threading.Lock()
        self.failed = False

    def load(self):
        try:
            if self.role == "tts":
                from supertonic import TTS
                model = TTS(model="supertonic-3", auto_download=True,
                    intra_op_num_threads=int(os.getenv("VOICE_THREADS", "4")), inter_op_num_threads=1)
                self.style = model.get_voice_style(os.getenv("TTS_VOICE", "F1"))
            else:
                from faster_whisper import WhisperModel
                model = WhisperModel(os.getenv("STT_MODEL", "small"),
                    device=os.getenv("STT_DEVICE", "cpu"), compute_type=os.getenv("STT_COMPUTE_TYPE", "int8"),
                    cpu_threads=int(os.getenv("VOICE_THREADS", "4")), num_workers=1, download_root="/models/whisper")
            self.model = model
        except Exception as error:
            self.model = None
            self.failed = True
            print(f"Local {self.role} model initialization failed ({type(error).__name__}). Check download access and cache permissions.", flush=True)

    def ready(self):
        if self.model is None:
            raise VoiceError("voice_unavailable", "Local voice model is downloading or unavailable.")
        if not self.lock.acquire(blocking=False):
            raise VoiceError("voice_busy", "Local voice is busy. Please try again.", 429)

    def tts(self, text, lang, speed):
        self.ready()
        try:
            samples, _ = self.model.synthesize(text, voice_style=self.style, lang=lang,
                                               speed=speed, total_steps=8, verbose=False)
            pcm = (np.clip(samples.flatten(), -1, 1) * 32767).astype("<i2").tobytes()
            output = io.BytesIO()
            with wave.open(output, "wb") as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(self.model.sample_rate)
                wav.writeframes(pcm)
            return output.getvalue()
        finally:
            self.lock.release()

    def stt(self, audio, lang):
        import av
        chunks, count = [], 0
        try:
            with av.open(io.BytesIO(audio)) as container:
                resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
                for frame in container.decode(audio=0):
                    for converted in resampler.resample(frame):
                        data = converted.to_ndarray().flatten()
                        count += data.size
                        if count > 320000:
                            raise VoiceError("audio_too_long", "Record up to 20 seconds at a time.", 413)
                        chunks.append(data)
                for frame in resampler.resample(None):
                    chunks.append(frame.to_ndarray().flatten())
            if not chunks:
                raise ValueError("empty")
            samples = np.concatenate(chunks).astype(np.float32) / 32768
            if len(samples) > 320000:
                raise VoiceError("audio_too_long", "Record up to 20 seconds at a time.", 413)
        except VoiceError:
            raise
        except Exception:
            raise VoiceError("invalid_audio", "Send a valid short audio recording.", 422) from None
        self.ready()
        try:
            segments, _ = self.model.transcribe(samples, language=lang, beam_size=3,
                vad_filter=True, condition_on_previous_text=False, vad_parameters={"min_silence_duration_ms": 300})
            return " ".join(segment.text.strip() for segment in segments).strip()
        finally:
            self.lock.release()

provider = LocalVoice()

<!-- All members: constraints for a camera assistant serving visually impaired people and handling sensitive recordings. -->
# Safety and Privacy Rules

## Local OCR

PaddleOCR receives an existing selected frame in memory, with bounded body size
and resolution. It writes no extra images, results or debug visualizations. Model
weights alone are cached. Existing saved-frame policies remain unchanged. The
language model is never asked to fill missing letters. A score below 0.85 in any
detected line suppresses all candidate text and asks the user to move closer.
OCR confidence is not a correctness guarantee; show uncertainty and verify important text.

## Live caregiver voice

Live voice uses direct encrypted WebRTC audio and is not recorded. No call audio,
transcript, SDP or ICE is stored in MySQL, RustFS or logs. Signaling tickets are
single use, expire after 20 seconds and travel in the first WebSocket frame,
never URL query strings. MySQL stores call ID, owning account, caller name,
phone session ID, start/end timestamps and end reason. An hourly task removes
ended call metadata older than 24 hours while the backend runs. Old typed-note
rows are preserved; the retired note routes are unavailable.

The current authorization model requires the same signed-in Aether account on
dashboard and phone. It does not implement separate caregiver invitations or roles.
Calls require an active foreground phone session. The phone announces the caregiver
before receiving audio, pauses assistant TTS, and provides an End live voice button
and voice commands. SOS ends the live call first. Stop session, backgrounding or
logout closes media. Microphone permission is requested only after Start talking.
Disconnect releases tracks and requires the caregiver to deliberately restart.
Use consenting participants; device speaker routing and echo behavior need physical tests.

## Local voice audio

The phone's AetherAudio module and local voice services keep microphone PCM,
uploaded audio and generated WAV in memory only. They do not save audio to disk,
HTTP multipart spool files, object storage or MySQL. Audio buffers are bounded
and released after use/cancellation; model weights alone are cached. Operating
system memory/swap behavior is outside the application's control.

Signed-in voice requests pass through backend authentication. Internal voice and
storage ports bind to loopback. Server voice is local Supertonic 3/faster-whisper;
vision retains the configured external provider. Explicit device voice fallback
may use Apple/Google's network recognition service depending on installed language
support. Wake detection requests on-device recognition. The pre-login safety
notice uses device speech so it remains available before server setup.

Test reports contain synthetic utterances only. Do not log real audio, transcripts
or authentication cookies for debugging. Existing consent, retention and image
privacy requirements below still apply.

- This is a helper, not a replacement for a white cane or guide dog.
- Never claim that an environment is safe. State uncertainty explicitly.
- Never implement face identification or recognition; generic person detection is acceptable.
- Use the app only with consenting test participants.
- Explain that audio/images may be sent to external pretrained AI API providers.
- Do not retain raw microphone recordings after transcription.
- "Hey Aether" is off by default. When turned on, the app listens only while it is open on screen and outside a session, using on-device speech recognition, and keeps nothing it hears.
- Faces are blurred in every frame before it is kept, sent to an AI service or stored. Bank cards and ID cards
  (the ID-1 card shape) are also blurred in every saved frame, without AI. ID numbers and addresses written on
  letters or forms can only be found by reading the text (OCR), so they are not blurred yet.
- Delete stored frames, metadata and question history within 24 hours.
- Keep video, history and image endpoints access-controlled; use HTTPS for mobile camera access.
- Keep API provider keys server-side, never in frontend bundles or git commits.

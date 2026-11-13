# Aether shared voice service

Member 1 implementation, 2026-11-13. This replaces the Azure placeholder with real cloud adapters. No provider keys are in the app or repository.

## Providers and cost

- STT: Groq `whisper-large-v3`, selected for multilingual accuracy. This uses **transcriptions**, not translations, and explicitly sends `en`, `ar`, or `fr`.
- TTS: Google `gemini-3.8-flash-tts`, voice `Kore`, via the Interactions API. Text is supplied as the verbatim transcript with a language/style annotation. WAV output is converted to MP3 for the existing team contract. `store: false` disables stored Interaction objects.
- Both have free-tier access, not unlimited free usage. Groq's published Whisper free limits are 20 requests/minute, 2,000/day, 7,200 audio seconds/hour and 28,800/day. Gemini limits depend on the project and are shown in AI Studio. Some Google projects require verification.
- **Use Groq Free and a Gemini project with billing disabled.** Code cannot determine whether a supplied key belongs to a paid account. There is no automatic upgrade, alternate paid provider, or automatic retry of quota failures.
- Free Gemini usage can be used to improve Google's products. `store: false` is not an exemption from those terms. Questions go to Groq; reply text goes to Google. The phone has an explicit API voice switch and keeps device voice as the default.

Verified official references: [Groq STT](https://console.groq.com/docs/speech-to-text), [Groq limits](https://console.groq.com/docs/rate-limits), [Groq data controls](https://console.groq.com/docs/your-data), [Gemini TTS](https://ai.google.dev/gemini-api/docs/speech-generation), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini quotas](https://ai.google.dev/gemini-api/docs/rate-limits), [Interaction storage](https://ai.google.dev/gemini-api/docs/interactions-overview).

## Local setup on this Windows laptop

1. Create a free key at [Groq API Keys](https://console.groq.com/keys).
2. Create a key in a free project at [Google AI Studio](https://aistudio.google.com/apikey). Leave billing disabled. Complete account/project verification if required.
3. In PowerShell, from the repository root, run:

```powershell
& mobile/native/.runtime/team-integration/python313/Scripts/python.exe mobile/voice-service/setup_keys.py
```

The input is hidden and saved in `mobile/voice-service/.env`, which Git ignores. This laptop already has the Python environment and FFmpeg. Both provider keys are required for the complete API voice flow; use the setup check below to inspect configuration without displaying secrets.

Check setup without contacting providers:

```powershell
& mobile/native/.runtime/team-integration/python313/Scripts/python.exe mobile/voice-service/setup_keys.py --check
```

Run the full local project as usual:

```powershell
npm.cmd --prefix mobile/native run start:team
```

The launcher serves voice on port **8001**, account/AI on **8002**, and media on **8889**. It reports missing keys truthfully. Restart an existing voice process after changes to code or keys. `services:team` retains its previous backend-only behavior; use `start:team` for the voice server too.

To run only voice manually, from `mobile/voice-service`:

```powershell
& ../native/.runtime/team-integration/python313/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001
```

For a teammate with a fresh environment: Python 3.12+, `python -m venv .venv`, install `requirements-dev.txt`, and install FFmpeg on PATH (or set `VOICE_FFMPEG` to its executable). Copy `.env.example` to `.env`, configure keys and `VOICE_AUTH_ORIGIN` for the shared account backend. The Dockerfile includes FFmpeg; supply secrets as runtime environment variables and point auth at the account service, not container localhost.

## Phone setup and behavior

**A new development IPA is required** because `expo-audio` is a new native dependency. An OTA/Metro reload does not install it. Use the existing `iPhone development IPA for sideloading` GitHub Actions workflow with the `codex/api-voice` branch, then install its IPA through Sideloadly. The keys stay on your server; the build does not need either provider key.

In Connection, keep the account and media addresses as usual. Voice defaults to the same laptop host on port 8001. Its optional address field permits a custom port or a same-host HTTPS reverse proxy. A different hostname is rejected because the account cookie would not authenticate there. Use trusted private-LAN HTTP for development; use HTTPS behind the shared host when deployed.

In Settings, check the voice service and enable **Use API voice**. Missing keys and old binaries show actionable messages. There is no silent fallback to device recognition. Switching back to device voice stops the active session.

1. “Hey Aether” remains the existing on-device English wake listener while the app is open.
2. The listener releases the microphone, existing haptics run, and the session greeting uses the selected voice mode.
3. API mode records a question locally. A local energy gate ends it after 1.4 seconds of quiet or 28 seconds total. Silence is discarded without an API call. This is energy detection, not semantic VAD; tune only after real-room phone tests.
4. The actual recording bytes go to `/transcribe`; its final text goes through the existing team `/ask` and MySQL History flow.
5. The returned answer goes to `/synthesize` and the MP3 plays. The microphone stays off during playback; listening resumes afterward.
6. Stop, language change, backgrounding and account lock cancel mobile requests and release audio. Late responses cannot start playback or become questions. Temporary recordings/playback files are deleted during cleanup; OS cache eviction is a fallback after interruption. A request already accepted by a provider can still consume quota after client cancellation.

The onboarding safety notice stays on device, so it does not depend on API keys. STT/TTS support French here; French **AI answers** still depend on Member 2's `/ask` language support. Speech generation does not implement the team's vision reasoning model.

## HTTP contract and protections

- `GET /health`: service identity, supported languages and configuration flags; no keys. `configured: true` is not proof of working credentials. `provider_verified` remains false until you run an actual test; it is not a persisted certification.
- `POST /api/v1/voice/transcribe`: multipart `audio` plus `language`; returns `{ "text": "...", "language": "ar" }`. Empty text means no speech.
- `POST /api/v1/voice/synthesize`: JSON `{ "text": "...", "language": "ar" }`; returns `audio/mpeg` with `Cache-Control: no-store`.
- Both POSTs require the existing Aether session cookie and `X-Aether-Voice: 1`. The service validates the account through the trusted server's `/api/v1/auth/me`; it never reads MySQL directly or forwards cookies to providers. Web origins must be explicitly allowed in `VOICE_CORS_ORIGINS`.
- 4 MiB audio input, 30-second maximum, 1–1,200 text characters, bounded provider responses/timeouts, two concurrent provider operations, ten operations per account/minute per process. These local guards complement provider quotas; production multi-worker deployments need shared rate limiting.
- Errors use `{ "error": { "code": "voice_quota", "message": "..." } }`; 429 includes `Retry-After`. Provider error bodies, recordings, text and secrets are not logged by this application.
- Shared YAML still says Azure and only EN/AR. It has not been edited because it is outside `/mobile`. The MP3/body/path contract is preserved; the team should update its provider/language documentation.

## Validation

Offline API tests mock only the external providers/auth endpoint and use **real FFmpeg** for audio conversion:

```powershell
cd mobile/voice-service
& ../native/.runtime/team-integration/python313/Scripts/python.exe -m pytest tests -q -p no:cacheprovider
```

After adding free keys, explicitly run the synthetic EN/AR/FR provider round trip (three TTS and three STT calls, consumes quota):

```powershell
& mobile/native/.runtime/team-integration/python313/Scripts/python.exe mobile/voice-service/verify_providers.py --live
```

Then validate on the rebuilt iPhone: greeting, each language, no self-transcription, Stop during upload/playback, backgrounding, quiet/noisy rooms, expired login, disabled Wi-Fi and exhausted quota. Automated tests and JS bundle exports do not replace this check.

One shared deployed backend needs one server's keys. Teammates running separate local servers should create their own free keys to avoid sharing quota. Never commit `.env` or include keys in `EXPO_PUBLIC_*` variables.

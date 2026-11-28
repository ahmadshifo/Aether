# Aether local setup (Windows 11)

This guide takes a teammate from a fresh Windows laptop to testing the complete
Aether stack, dashboard and Android or iPhone. Commands run in PowerShell from
the repository root unless a step says otherwise. Use branch `feat/local-docker-voice`
until the team approves a merge. Do not assume main already contains these changes.

This branch uses Docker for MySQL, RustFS, local voice and local OCR.
It does not migrate, clear or replace your old data.
First installation downloads several large packages and model files. Allow
at least 15 GB free for images/models and application dependencies, and at least
8 GB RAM available to Docker (more is helpful alongside Android Studio).

## 1. Tools

Install Git, Node LTS, Python 3.13, Docker Desktop and ngrok:

```powershell
winget install --id Git.Git --exact
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Python.Python.3.13 --exact
winget install --id Docker.DockerDesktop --exact
winget install --id Gyan.FFmpeg --exact
winget search --id Ngrok.Ngrok --exact
winget install --id Ngrok.Ngrok --exact
```

If Docker requests WSL2, run `wsl --install` in an administrator PowerShell,
restart Windows if requested, open Docker Desktop and select Linux containers
with the WSL2 engine. Verify `docker version` and `docker compose version`.
Open a new terminal after installing tools. Use Node 22.23.4 or newer.
Verify `ffmpeg -version`; the multimedia stream reader requires FFmpeg on PATH.
The local live-stream checks used the already installed FFmpeg 9.0.1 binary.
Install Android Studio (`winget install --id Google.AndroidStudio --exact`)
and its SDK, platform tools and emulator only if building Android locally;
use JDK 17 and the SDK versions requested by Expo's generated Gradle project.
An iPhone build needs a Mac/Xcode or the repository's macOS GitHub workflow.

## 2. Clone and private configuration

```powershell
git clone https://github.com/ahmadshifo/Aether.git
cd Aether
git switch feat/local-docker-voice
node scripts/configure-local.mjs
```

The script creates root `.env` with random MySQL, S3 and JWT secrets, and copies
missing service `.env.example` files to `.env`. It leaves existing files alone.
Never share these files or run `docker compose config` without `--quiet` in
a shared recording, because the expanded configuration contains secrets.

Root `.env` supplies existing variable names to host services when started with
`npm start`: `MYSQL_*`, `DATABASE_URL`, `JWT_SECRET`, `FRAME_STORAGE_BACKEND`,
`S3_*` and `VOICE_SERVICE_URL`. Database password in DATABASE_URL must be
URL-encoded if changed manually. Changing passwords in .env after volume
creation does not change MySQL's stored users; rotate them deliberately.

For a manual JWT secret, run this locally and save the result privately:

```powershell
py -3.13 -c "import secrets; print(secrets.token_urlsafe(48))"
```

Fill GEMINI_API_KEY and the existing vision settings in `web/ai-backend/.env` and
`multimedia/api/.env` privately. Gemini remains the vision provider; this feature
does not replace it. Keep any existing optional OpenAI vision choices your team uses.
No speech or OCR API keys are required. `web/dashboard/.env` contains public origins
only. `mobile/voice-service/.env.example` documents Docker voice settings; root
Compose is authoritative for Docker, not that service's private file.

The generated root credentials point to a fresh Docker database. Old local
accounts/history are not automatically copied; see migration below.

## 3. Dependencies

```powershell
py -3.13 -m venv web/ai-backend/.venv
.\web\ai-backend\.venv\Scripts\python.exe -m pip install -r web/ai-backend/requirements.txt pytest
py -3.13 -m venv multimedia/api/.venv
.\multimedia\api\.venv\Scripts\python.exe -m pip install -r multimedia/api/requirements.txt
npm.cmd --prefix web/dashboard ci
npm.cmd --prefix mobile/native ci
```

Voice Python dependencies install inside its Docker image. The service pins
Supertonic 1.3.1 and faster-whisper 1.2.1. Install the tested MediaMTX 1.21.3
Windows binary if it is missing (AMD64 Windows; use the matching release for ARM):

```powershell
if (-not (Test-Path mobile/streaming/mediamtx-local/mediamtx.exe)) {
  $archive = Join-Path $env:TEMP 'aether-mediamtx-1.21.3.zip'
  Invoke-WebRequest -UseBasicParsing 'https://github.com/bluenviron/mediamtx/releases/download/v1.21.3/mediamtx_v1.21.3_windows_amd64.zip' -OutFile $archive
  if ((Get-FileHash -Algorithm SHA256 $archive).Hash -ne 'b2f5246b07cb72961df03b8d5e8cad43dc657bcf3f49a87bb031bdf22721af74') { throw 'MediaMTX checksum mismatch' }
  Expand-Archive -LiteralPath $archive -DestinationPath mobile/streaming/mediamtx-local
}
```

The launcher uses the repository's `mobile/streaming/mediamtx.yml`, not the
default configuration inside the downloaded archive. Keep binaries out of Git.

## 4. Start, inspect and stop

Check existing listeners first. If another MySQL or RustFS instance uses 3307 or
9000, back up its data and stop that instance before switching. Never kill an
unidentified process or delete its data directory.

```powershell
netstat -ano | findstr LISTENING
docker compose config --quiet
docker compose up -d --build
npm.cmd start
```

`npm start` loads root .env, runs Compose with healthcheck waiting, initializes
only missing multimedia schema objects (existing incompatible tables cause an
error), then starts MediaMTX, backend, multimedia API, dashboard and Expo.
Future starts need only Docker Desktop running plus `npm.cmd start`.
After pulling voice or OCR service code changes, use `npm.cmd start -- --build-services`
to rebuild the images. Ordinary starts reuse the images so a second startup
does not interrupt a model download already in progress.
The first model download may take much longer than a normal startup.
A /health response of 503 means models are not ready, not that inference passed.

| Port | Service | Check |
| --- | --- | --- |
| 3307 TCP, loopback | MySQL 8.4 | `docker compose ps` |
| 9000 TCP, loopback | RustFS private S3 | `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9000/health` |
| 9001 TCP, loopback | RustFS console | Browser; sign in with private root S3 credentials |
| 8001 TCP, loopback | Local voice TTS gateway, internal STT worker | `Invoke-RestMethod http://127.0.0.1:8001/api/v1/voice/health` |
| 8004 TCP, loopback | PaddleOCR CPU worker | `Invoke-RestMethod http://127.0.0.1:8004/health` |
| 8002 TCP, LAN | Authenticated AI backend, history, voice proxy | `/api/v1/auth/me` returns 401 until login |
| 8003 TCP, loopback | Multimedia API | `/health` |
| 5174 TCP, loopback | Dashboard | `http://localhost:5174` |
| 8083 TCP, LAN | Expo Metro | `http://LAPTOP_IP:8083/status` |
| 8889 TCP, LAN | MediaMTX WHIP/WHEP | Open media origin in Connection |
| 8189 UDP, physical LAN adapter | WebRTC ICE media | Verify live video on phone and dashboard |
| 8554 TCP | RTSP ingestion | Used internally by multimedia |
| 9997 TCP, loopback | MediaMTX admin API | `/v3/paths/list` |

```powershell
docker compose ps -a
docker compose logs --tail 30 voice-tts voice-stt ocr
# Ctrl+C in npm start stops only app processes it started.
docker compose stop
# Optional: remove containers but retain named data/model volumes.
docker compose down
```

Do not run `docker compose down -v`; it deletes named volumes. Do not run
`npm run db:clear` for setup. Logs and model weights persist as appropriate;
recorded/generated voice audio is memory-only.

## 5. New phone build and connection

Both iPhone and Android need a new **development build from this branch** to
include the AetherAudio native module and its new routeSpeaker method. Existing
builds can fall back for speech but cannot receive this live call feature. A Metro
reload cannot install native modules. Expo Go cannot test these native features.

### Android installation from Windows

Install Android Studio and Java 17 if they are not installed:

```powershell
winget install --id Google.AndroidStudio --exact
winget install --id EclipseAdoptium.Temurin.17.JDK --exact
```

Open Android Studio and finish its setup wizard. In SDK Manager install Android
SDK Platform 37, SDK Build Tools 37.0.0, Platform Tools and Command-line Tools.
The checked React Native version also requests NDK 27.1.12297006; install it
under SDK Tools with Show Package Details enabled. Accept the SDK licenses.
Use the version requested by Gradle if a future dependency update changes these.

On Samsung, open Settings, About phone, Software information and tap Build number
seven times. Open Developer options, enable USB debugging, connect by a data-capable
USB cable, unlock the phone and accept the computer's debugging prompt. If Windows
does not see the phone, install the manufacturer's ADB driver. See the
[official Android device setup](https://developer.android.com/studio/run/device).

In the PowerShell terminal used for building, set the installed tool paths:

```powershell
$env:JAVA_HOME = (Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-17*' | Sort-Object Name -Descending | Select-Object -First 1).FullName
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
java -version
adb devices
```

If JAVA_HOME is empty, locate the actual Java 17 install folder and set it directly.
If Android Studio shows a different SDK location, use that for ANDROID_HOME.
`adb devices` must show the phone as device, not unauthorized. Then build from
this branch. Keep root `npm start` running in the original terminal:

```powershell
cd mobile/native
$env:AETHER_LAN_HOST = 'any'
npx.cmd expo run:android --device --no-bundler
cd ../..
```

Or build a development APK using your Expo account:
`npx.cmd eas-cli build --platform android --profile development` from mobile/native.
EAS has account/plan limits; a local Android build does not require EAS.
The LAN build flag permits private HTTP testing; Connection still restricts the
address to a private host. Choose the correct device if several are connected.
The Expo command compiles and installs the development app. It reuses the Metro
server started on 8083; do not open a second bundler on 8081. See
[Expo local builds](https://docs.expo.dev/guides/local-app-development/).

### iPhone installation from Windows

iPhone: on GitHub open Actions -> **iPhone development IPA for sideloading** ->
Run workflow -> select `feat/local-docker-voice`. Download that run's unsigned IPA
artifact, install with Sideloadly using your own Apple account, trust the profile
and enable Developer Mode if needed. Free signing needs periodic renewal. The
workflow uses macOS/Xcode; Windows cannot compile the iOS native code itself.

Install the Windows version from [Sideloadly's official site](https://sideloadly.io/).
Follow its current Apple device-support dependency prompts. Connect the unlocked
iPhone by USB, tap Trust this computer on the phone, and make sure its name appears
in Sideloadly. If it is missing, check the cable and Apple Mobile Device Support
installation before attempting to sign the app.

Unzip the GitHub artifact, drag its .ipa file into Sideloadly, select your phone,
enter your own Apple ID privately and click Start. Complete verification privately
until Sideloadly says Done. On the iPhone, trust the developer profile under
Settings, General, VPN and Device Management if prompted. Enable Developer Mode
under Privacy and Security and restart if iOS requires it. Open Aether afterward.
Do not change the app bundle ID while updating if you want to preserve local settings.

### Connect either phone

Put phone and laptop on the same Wi-Fi or connect laptop to the phone's hotspot.
Run `ipconfig` to find the physical adapter's IPv4. The launcher selects a physical
LAN adapter, excluding virtual/VPN interfaces. Override `AETHER_LAN_HOST` in root
.env when needed. MediaMTX binds ICE to that actual address, not a hardcoded
adapter name or previous home's IP.

Open the Expo QR code or `http://LAPTOP_IP:8083` in the development launcher.
In Aether Connection, use backend `http://LAPTOP_IP:8002` and media
`http://LAPTOP_IP:8889`; allow private LAN HTTP for local testing. Allow the app's
microphone, speech, camera and Local Network permissions. Permit Node/Python and
MediaMTX on Windows Firewall's private network; do not disable the firewall.

## 6. End-to-end checks

1. Confirm voice /health says ready, both models ready, languages en/ar/fr.
2. Sign in on phone and dashboard using the same account. Start a camera session.
3. Ask a short English question, then Arabic, then French; pause briefly after
   speaking. Check transcript, answer, spoken language and history on dashboard.
4. While an answer speaks, say stop; also test read it again, slower/faster and
   vibration. Try a quiet room and a room with background noise.
5. Test foreground Hey Aether, camera off/on, and stop session.
6. Stop voice containers briefly; verify the translated phone fallback notice and
   device recognition/speech. Start them again, wait 60 seconds, and retry.
7. Confirm phone voice audio is not in history storage; only question text/answers
   and existing permitted image evidence are stored.

### Create the account and connect the interfaces

Open `http://localhost:5174` on the laptop. Use Sign up to create an Aether test
account in this laptop's MySQL. Use exactly that account on the phone; Expo,
Google and Apple accounts are unrelated. A fresh clone does not copy another
laptop's users, history, private keys or RustFS objects. If teammates need shared
history, point their apps to one deliberately shared backend instead of separate
databases. Keep the laptop awake while testing.

For Gemini, open https://aistudio.google.com/apikey in your own browser, create a
key under your account, and paste it privately into the service .env files named
above. Keep AI_PROVIDER=gemini and the team's configured model unless deliberately
changing providers. Do not paste keys in chat, GitHub issues or phone settings.
Gemini quotas can still limit visual answers; local OCR and speech do not use them.

The Connection page is inside Aether. The development launcher URL (:8083),
backend URL (:8002) and media URL (:8889) are three different addresses. Never
put localhost in the phone's fields: that would mean the phone itself.

### Test reading text

Check `http://127.0.0.1:8004/health` on the laptop: ready must be true and languages
must include en, ar and fr. On the phone select the language of the printed text,
point at a well-lit sign and ask Read the sign. Repeat in French and Arabic.
Test blank paper, blur and small distant text. The app must say unclear/move closer
when the recognizer's confidence is low and report no text for a blank frame.
It never asks Gemini to fill unreadable words. Confidence cannot guarantee perfect
recognition, especially Arabic or motion blur; verify important text independently.

### Test a live caregiver call

1. Keep a phone session active and listening. Log into the dashboard with that same account.
2. On Overview or Live Camera find Talk to user. Click Start talking and allow the mic.
3. Expect Connecting, then a chime and caregiver announcement on the phone, then Live.
   Speak normally. The meter should move. Assistant TTS pauses during the call.
4. Click Stop talking. Audio must stop. Start again to verify another call.
5. On the phone tap End live voice. Also test saying Hang up, Raccroche or
   أوقف المكالمة. These stop the call, not the camera session.
6. During a call test camera off/on by voice. Test SOS with a consenting test
   contact and cancel its countdown before any real emergency call.
7. Disconnect Wi-Fi briefly. Expect Failed/Ended and released mic; reconnect and
   click Start talking again. Calls do not resume automatically in the background.
8. Deny mic permission once; expect a clear error. Re-enable microphone permission
   for this site in the browser's site settings and retry. No mic also has its own error.

Use headphones on the caregiver laptop to reduce feedback during physical tests.
Browser mic needs localhost or HTTPS. An HTTP LAN URL such as http://192.168.x.x:5174
is not a secure context. Live audio is peer-to-peer on a reachable LAN and is not
recorded. The existing account model has no separate caregiver invitation or role:
sharing an account means sharing its access. No unrelated account may call this phone.
The visible phone button is the chosen screen gesture; no volume-button override is added.

Automated local model smoke test (synthetic generated audio is sent straight to
STT in RAM, never saved):

```powershell
$env:PYTHONUTF8 = '1'
.\web\ai-backend\.venv\Scripts\python.exe mobile/voice-service/tests/smoke_local.py > "$env:TEMP\aether-voice-latency.jsonl"
```

This measures TTS/STT latency and prints recognized synthetic text. It is not a
human listening test or an accuracy benchmark for Lebanese Arabic/noisy rooms.

## 7. Models, fallback and privacy

### PaddleOCR models

The CPU image pins PaddleOCR 3.7.0 and PaddlePaddle 3.3.1. Although the current
package has a newer default model family, explicit PP-OCRv5 multilingual models
provide the required Arabic coverage. The detector is PP-OCRv5_mobile_det;
recognizers are en_PP-OCRv5_mobile_rec, latin_PP-OCRv5_mobile_rec and
arabic_PP-OCRv5_mobile_rec. Phone questions choose en/fr/ar per request.
Background frame OCR uses OCR_DEFAULT_LANGUAGE, default en. Cache is the
ocr_models volume under /models/.paddlex. First startup downloads all three;
later restarts reuse them. The CPU worker uses four threads and one inference at a time.

OCR_MIN_CONFIDENCE defaults to 0.85. Any detected line below it suppresses the
whole text. No detected lines yields no_text. The worker accepts up to 4 MiB,
rejects oversized dimensions, and processes a bounded 1600-pixel image in RAM.
No debug images or extra OCR copies are saved. Do not lower the threshold just
to make a blurry test pass. See the validation report for measured Arabic results.

Optional NVIDIA GPU OCR, after building the CPU base image:

```powershell
docker compose build ocr
docker compose -f docker-compose.yml -f docker-compose.ocr-gpu.yml up -d --build ocr
```

This installs PaddlePaddle GPU 3.3.1 from the official CUDA 12.6 wheel index.
It requires a compatible NVIDIA GPU/driver and Docker GPU support. It is not
hardware-tested here. Set COMPOSE_FILE to both files in that terminal before
running npm start, otherwise the launcher restores the default CPU definition:

```powershell
$env:COMPOSE_FILE = 'docker-compose.yml;docker-compose.ocr-gpu.yml'
npm.cmd start
```

Use a third file, docker-compose.gpu.yml, only if also enabling GPU STT. Return
to CPU by removing COMPOSE_FILE and running docker compose up -d. Preserve caches.
Official sources: [installation](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/installation.en.md),
[multilingual models](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/algorithm/PP-OCRv5/PP-OCRv5_multi_languages.en.md),
[GPU wheels](https://www.paddlepaddle.org.cn/packages/stable/cu126/paddlepaddle-gpu/).

### Local speech

Supertonic 3: ONNX CPU TTS, bundled voice F1, eight generation steps, en/ar/fr.
Python package MIT; model weights **OpenRAIL-M** with use restrictions. The
[upstream repository](https://github.com/supertone-oss-archive/supertonic-py)
is archived: no promised maintenance or security fixes. Review the
[model license](https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE)
before distribution. Models cache in Docker volume `voice_models`.

[faster-whisper](https://github.com/SYSTRAN/faster-whisper) uses multilingual
`small` with CPU int8 and beam size 3. It favors Arabic/French accuracy over
`tiny/base` speed, while avoiding medium/large CPU latency and RAM requirements.
Set `STT_MODEL=base` for a slower laptop and retest accuracy. Do not use an
English-only `.en` model. Model download requires internet once.

Optional GPU: `docker-compose.gpu.yml` uses Python 3.12 with pinned NVIDIA
CUDA12/cuDNN9 libraries for STT, following upstream's pip-library approach.
Install a compatible NVIDIA driver and Docker GPU
support first. This optional image was not hardware-tested here. From PowerShell:

```powershell
$env:COMPOSE_FILE = 'docker-compose.yml;docker-compose.gpu.yml'
docker compose config --quiet
docker compose up -d --build
npm.cmd start
```

TTS stays CPU; STT becomes CUDA/float16. Verify `nvidia-smi` in the GPU container
and rerun all language tests. To return to CPU, remove COMPOSE_FILE from the
terminal with `Remove-Item Env:COMPOSE_FILE`, then run `docker compose up -d`.

Native fallback is in `mobile/native/src/voice/localVoice.ts`. Missing native
module, unavailable/busy model or network failure selects device recognition
(`recognition.ts`) or device speech (`speech.ts`), with translated notice. A
failed transcription cannot be replayed after its buffers are cleared, so the
user may need to repeat it. Retries resume after a 60-second cooldown. Built-in
recognition may use Apple/Google's service depending on OS/language; install
offline language support if required. Wake word stays explicitly on-device.
The first-use warning is deliberately device-spoken before login/backend setup.

AetherAudio uses AudioRecord/AudioTrack on Android and AVAudioEngine/AVAudioPlayer
with Data on iOS. No recording URI, temporary audio file or upload spool is used.
Only model files persist. Stop, logout and backgrounding release audio resources.
OS-level audio routing, echo cancellation and barge-in require physical testing.

## 8. Safe MySQL data migration (manual, optional)

Do this before allowing anyone to create data in the new Docker database.
Keep the old installation and backup until you have verified counts and logins.
These commands do not clear either database. Source port below is the old local
3307; destination uses the same port, so they must run at different times.

1. While the **old native MySQL** is running, dump the intended database. Replace
   the executable path, username and database with your existing values. Password
   is prompted, never put it on the command line.

```powershell
$dump = Join-Path $env:TEMP 'aether-before-docker.sql'
& 'C:\Users\user\mysql84\mysql-8.4.13-winx64\bin\mysqldump.exe' --host=127.0.0.1 --port=3307 --user=YOUR_OLD_USER --password --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF --skip-add-drop-table --result-file=$dump aether_multimedia
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; do not continue.' }
Get-Item -LiteralPath $dump | Select-Object Length,LastWriteTime
```

2. Stop the old native server using its original terminal/service. Start only
   Docker MySQL. Check the destination is empty **before** importing.

```powershell
docker compose up -d mysql
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql -u"$MYSQL_USER" -D"$MYSQL_DATABASE" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()"'
```

If the count is nonzero, STOP: do not import over existing tables. Use a separate
backup/test database or request a deliberate merge plan. The dump intentionally
omits DROP TABLE statements. Once count is zero and health is ready:

```powershell
$mysqlContainer = docker compose ps -q mysql
docker cp $dump "${mysqlContainer}:/tmp/aether-import.sql"
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql --default-character-set=utf8mb4 -u"$MYSQL_USER" "$MYSQL_DATABASE" < /tmp/aether-import.sql'
if ($LASTEXITCODE -ne 0) { throw 'Import failed; keep the backup and investigate.' }
docker compose exec -T mysql rm /tmp/aether-import.sql
```

If you already ran npm start, the destination has tables. Preserve those too by
importing into a **new database name** instead. Open the Docker MySQL root client
with `docker compose exec mysql mysql -uroot -p` and enter the root password
privately. For example, run these SQL statements (substitute your configured
application username if it is not `aether`):

```sql
CREATE DATABASE aether_import_20261127 CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON aether_import_20261127.* TO 'aether'@'%';
```

Do not use IF NOT EXISTS here: a pre-existing name should stop the procedure.
Use the same docker cp/import commands above, but replace `"$MYSQL_DATABASE"`
in the import command with `aether_import_20261127`. After checking imported row
counts, change MYSQL_DATABASE and the database name inside DATABASE_URL in root
.env to that new name, then restart npm start. Keep the original source and the
previous Docker database; switching those two settings back is your rollback.

Inspect table row counts and sample history using your MySQL client, then run
`npm start`. MySQL metadata alone does not copy RustFS JPEG objects. Back up and
copy the old private bucket with an authenticated S3 client before retiring the
old RustFS service; keep keys and object paths identical. Do not delete old files.
The new initializer never deletes objects or silently changes an existing bucket
policy. Keep backups private; they contain personal account/history data.

## 9. ngrok and remote access

The verified Windows package is `Ngrok.Ngrok`. After installation, open your own
terminal and enter your token privately; do not paste it in chat:

```powershell
ngrok config add-authtoken <your-token>
ngrok http 8002
# In a separate terminal, if your account allows another simultaneous endpoint:
ngrok http 5174
```

Backend HTTPS supports authenticated APIs, local voice and history. Dashboard's
same-origin Vite proxies still run on the laptop. Configure the exact public
dashboard hostname with Vite's `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` environment
variable before starting; do not broadly allow every host. Use HTTPS and secure
cookies for real external use. Free ngrok endpoint/domain/concurrency limits may
prevent both tunnels at once. Exposing the development dashboard is a supervised
test, not a production deployment.

An HTTP ngrok tunnel does **not** carry MediaMTX's UDP ICE traffic (:8189). Making
:8889 signaling reachable alone does not make WebRTC video work. Use the same LAN
for video, or deploy a properly authenticated TURN relay/public MediaMTX with
reachable UDP and TLS, or a private mesh VPN that carries UDP. Metro :8083 is
also separate; a voice/backend tunnel does not deliver your development bundle.
Do not expose MySQL, RustFS, voice :8001 or MediaMTX's admin :9997.
Keep OCR :8004 private too. Live caregiver audio also uses WebRTC UDP; an HTTPS
dashboard can gain microphone permission while its call still fails across NAT.
A TURN relay is not configured by this feature. Use one backend worker: multiple
workers do not share live-call tickets. Restarting the backend ends all calls.

## Troubleshooting

- Docker pipe missing: open Docker Desktop, check WSL2/Linux containers and restart
  the terminal after installation.
- Port already used: identify it with netstat; reuse/stop the intended original
  service yourself. Startup refuses to substitute for an unrelated listener.
- Voice unhealthy/loading: initial model download may be slow; inspect
  `docker compose logs --tail 30 voice-tts voice-stt`. Check internet/disk/RAM.
  Restart a failed worker after resolving the cause. Do not delete model volumes.
- Fresh DB looks empty: the old native DB still exists. Use the migration steps;
  do not clear records to fix a login problem.
- Changed Wi-Fi: update AETHER_LAN_HOST or remove the override, restart npm start,
  update phone Connection addresses, check Safari's Metro /status.
- Voice works only with the phone engine: install the new native build and check
  authenticated voice health; the first-use notice intentionally uses device TTS.
- Slow recognition: test shorter questions or base model; retain multilingual
  weights. This is final utterance recognition, not live partial transcription.
- Model hears its own voice: test speaker volume, headset and quiet room. Native
  echo cancellation is requested but cannot be guaranteed for every audio route.
- Wrong/wobbly depth or no safe passage: distance is uncertain assistive information,
  never a replacement for a cane/guide dog or a guarantee of safety.

## Tests and review

Use TEMP for test reports, not the repository:

```powershell
.\multimedia\api\.venv\Scripts\python.exe -m pytest tests -q -o "cache_dir=$env:TEMP/aether-root-pytest-cache" > "$env:TEMP\aether-root-tests.log"
node scripts/with-env.mjs web/ai-backend .venv/Scripts/python.exe -m pytest tests -q -o "cache_dir=$env:TEMP/aether-backend-pytest-cache" > "$env:TEMP\aether-backend-tests.log"
node scripts/with-env.mjs multimedia api/.venv/Scripts/python.exe -m pytest tests -q -o "cache_dir=$env:TEMP/aether-media-pytest-cache" > "$env:TEMP\aether-media-tests.log"
npm.cmd --prefix mobile/native run typecheck
npm.cmd --prefix mobile/native test > "$env:TEMP\aether-native-tests.log"
npm.cmd --prefix mobile/native run test:ui -- --cacheDirectory "$env:TEMP\aether-jest-cache" > "$env:TEMP\aether-native-ui.log"
```

The wrapper loads private root settings and runs from the service's directory.
Root tests now cover OCR language, confidence, invalid image, busy and loading paths.
For real database checks set `AETHER_MYSQL_INTEGRATION=1` for the backend and
`RUN_MYSQL_TESTS=1` for multimedia before rerunning their commands. Use only a
development database: these suites create and clean their own test records.
Run `node scripts/with-env.mjs multimedia api/.venv/Scripts/python.exe ../scripts/check-storage.py`
for a temporary UTF-8 MySQL row and a private RustFS object round trip.

Voice unit tests run in a disposable container without loading models:

```powershell
docker compose run --rm --no-deps -e VOICE_ROLE=tts -v "${PWD}/mobile/voice-service/tests:/tests:ro" --entrypoint sh voice-stt -c 'pip install --quiet pytest && python -m pytest /tests -q -o cache_dir=/tmp/pytest'
```

Voice unit tests use stubbed inference; real model tests use smoke_local.py.
The new OCR benchmark and browser call check run as follows:

```powershell
$env:PYTHONUTF8 = '1'
.\multimedia\api\.venv\Scripts\python.exe -m pip install arabic-reshaper python-bidi
.\multimedia\api\.venv\Scripts\python.exe tests/fixtures/ocr/generate.py
.\multimedia\api\.venv\Scripts\python.exe tests/ocr_benchmark.py > "$env:TEMP\aether-ocr-results.json"
.\web\ai-backend\.venv\Scripts\python.exe -m pip install playwright
node scripts/with-env.mjs web/ai-backend .venv/Scripts/python.exe ../../tests/live_voice_browser.py > "$env:TEMP\aether-live-call-tests.log"
npm.cmd --prefix web/dashboard run build
& mobile/native/node_modules/.bin/oxlint.cmd web/dashboard/src web/dashboard/vite.config.js
```

The browser check uses installed Google Chrome on Windows; set PLAYWRIGHT_BROWSER
to another compatible Chromium executable if needed. It creates and removes only
its own synthetic accounts, sends synthesized audio in memory, and measures loopback
audio arrival. It does not prove physical phone speaker routing or LAN latency.
The OCR generator uses Windows Arial without copying the font into Git. Fixtures
are synthetic. Their CER includes abstentions as missing characters; it is not a
general OCR accuracy benchmark. See OCR-AND-LIVE-VOICE-VALIDATION.md for results.
Review all `mobile/` changes with Hassan and `multimedia/` changes with ahmadshifo.
No merge to main is part of this setup.

Local port conflict: if an unrelated project already uses 3307, leave it running.
Set MYSQL_PORT to an unused port (for example 3308) in root .env and update the
port inside DATABASE_URL to match. Compose and npm start then use that port.
3307 remains the default shared setup. Never connect Aether to another project's
MySQL just because its listener is reachable.

## Everyday startup and updates

### Retention before testing with personal data

The stored-frame policy is 24 hours. The current root launcher does not start the
legacy deletion worker automatically, so starting the app is not proof of expiry.
Preview eligible records first; do not delete a teammate's data during setup:

```powershell
node scripts/with-env.mjs multimedia api/.venv/Scripts/python.exe -m database.retention --once --dry-run
```

After the data owner approves that scope, keep a separate terminal running the
worker with `--worker --execute` instead of `--once --dry-run`. It deletes eligible
stored frames and their objects. The separate live-call metadata sweep is automatic.
No global retention deletion was run against existing data during this feature test.

### Daily commands

Open Docker Desktop. Put laptop and phone on the same network. In PowerShell:

```powershell
cd C:\path\to\Aether
npm.cmd start
```

Keep that terminal running. Open Aether, choose the printed development-server
address if needed, and update Connection if the laptop's IP changed. Open the
dashboard at http://localhost:5174. You do not need USB after installing a valid
development build, but you still need the development server and reachable backend.
Free iPhone signing may need renewal. Android debug builds do not use that signing cycle.

Before updating, save your work and inspect git status. Then:

```powershell
git status --short --branch
git pull --ff-only origin feat/local-docker-voice
npm.cmd --prefix mobile/native ci
npm.cmd --prefix web/dashboard ci
.\web\ai-backend\.venv\Scripts\python.exe -m pip install -r web/ai-backend/requirements.txt
.\multimedia\api\.venv\Scripts\python.exe -m pip install -r multimedia/api/requirements.txt
npm.cmd start -- --build-services
```

Do not pull over conflicting local edits or reset them. Once this feature is
approved and merged, deliberately switch to main and pull main instead. Native
module/dependency changes require a new phone build; JavaScript-only changes
usually arrive from Metro. Existing model/data volumes survive ordinary rebuilds.
The Android bottom bar remains its existing platform-specific layout.

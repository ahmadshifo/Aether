# Task 14: live RTSP processing and team handoff

This guide uses PowerShell on Windows 11. All commands run from `multimedia/`
with the virtualenv executable explicitly, avoiding the system-Python/pytest
and working-directory issues encountered earlier:

```powershell
Set-Location "C:\Users\Technoline\Desktop\multimedia-project\multimedia"
```

See [the verification report](LIVE_VERIFICATION.md) for actual test results,
changed files and remaining cross-team work. No private `.env` was rewritten.

## Architecture and contract

The mobile browser publishes camera video using WHIP, WebRTC's HTTP publishing
interface. MediaMTX accepts that publisher. Member 3 reads its RTSP stream over
TCP; Member 2's browser reads the same stream through WHEP, WebRTC's playback
interface. These are different protocols for the same session path:

```text
Phone --WHIP--> MediaMTX --RTSP/TCP--> capture subprocess
                  |                       |
                 WHEP              bounded sampling queue
                  |                       |
              Dashboard           one Task 13 analysis worker
                                          |
                                   MySQL + private JPEG
                                          |
                                      FastAPI
```

For the SAME actual UUID in every component:

| Purpose | URL |
| --- | --- |
| Mobile publish | `http://MEDIA_HOST:8889/live/{session_id}/whip` |
| Python read | `rtsp://MEDIA_HOST:8554/live/{session_id}` |
| Dashboard playback | `http://MEDIA_HOST:8889/live/{session_id}/whep` |

Use your actual configured host/ports and HTTPS termination. `127.0.0.1` below
is specifically a same-computer test address, not an invented LAN server IP.
The shared media/API contracts, mobile publisher, dashboard, root Compose and
their configuration files were not modified. Existing mobile code prefers
H.264 when offered by the browser; negotiation still needs checking on the
actual device. The reader does not require 15 FPS, 720p or an audio track.

## Configuration

The established `RTSP_STREAM_URL` is reused rather than adding competing host
and path variables. It accepts `SESSION_ID` or `{session_id}` in the exact
`live/` path. A configured fixed UUID must match the supplied session. Only a
trusted operator/environment supplies this URL; no HTTP endpoint accepts it.
Session IDs are validated UUIDs. Reconnection never changes the session.

```dotenv
RTSP_STREAM_URL=rtsp://localhost:8554/live/SESSION_ID
MEDIA_RTSP_TRANSPORT=tcp
LIVE_OPEN_TIMEOUT_SECONDS=5
LIVE_READ_TIMEOUT_SECONDS=10
LIVE_SAMPLE_INTERVAL_SECONDS=1
LIVE_QUEUE_SIZE=3
LIVE_RECONNECT_INITIAL_SECONDS=1
LIVE_RECONNECT_MAX_SECONDS=15
LIVE_MAX_RECONNECT_ATTEMPTS=8
LIVE_MAX_CANDIDATE_AGE_SECONDS=5
LIVE_MAX_CONSECUTIVE_FAILURES=3
LIVE_MAX_TEST_FRAMES=5
LIVE_TEST_DURATION_SECONDS=20
```

Process environment overrides the existing private `api/.env`. The example
was appended, preserving database, AI, API, storage and retention settings.
Optional URL-encoded RTSP credentials stay only in private configuration.
URL/settings representations and reports omit credentials; native FFmpeg stderr
is silenced only in the capture subprocess because it can echo authenticated
URLs. Safe stage/error codes remain observable.

Task 13's stricter PIPELINE_SAMPLE_INTERVAL_SECONDS wins if greater than the
live interval. Sampling and selection starts are each limited to at most one
per interval, independent of FPS. CLI overrides cannot make that policy faster.
Queue size is 1–10, default 3; test duration is bounded (default 20 seconds,
maximum one day); accepted-frame budget defaults to 5 (maximum 10000).
Maximum candidate age is at most 10 seconds, default 5.

## Reuse, timestamps and backpressure

`RTSPFrameSource.frames(stop_event)` continuously reads actual decoded frames
in a spawned capture process. A one-frame IPC mailbox prevents native capture
from waiting for AI. The acquisition thread samples by monotonic arrival time
and offers candidates to a separate bounded queue. When full it drops the
oldest pending candidate. A single analysis thread calls
`MultimediaPipeline.process_live_frame()`; no SDK/filter/storage workflow is
duplicated. That method adapts to existing Task 6 selection and Task 7-10 OCR,
combined objects/caption, semantic embedding and safe repository persistence.

The selector persists across reconnects: unchanged scenes can remain duplicates;
periodic coverage remains the existing 10-second policy. Failed analyses are
not retried automatically and do not insert fabricated partial records. A
provider quota/auth/configuration error or fatal storage error stops the runner.
Three consecutive analysis failures also fail explicitly (configurable), rather
than silently retrying forever. Rejected frames never call AI or save JPEGs.

Each LiveFrame carries UUID, increasing decoded sequence, image, receiver UTC
arrival, monotonic arrival and connection segment. Reconnects preserve UUID,
advance sequence and generate fresh arrivals/UUIDs. Database captured_at means
**receiver arrival after decoding**, not the camera's original exposure time.
Native/network buffering before arrival is not measurable as true camera
latency. Monotonic elapsed time drives selection only; live rows store
`video_timestamp_ms = NULL`. `source_frame_index` is the one-based decoded
sequence, with gaps when frames are skipped. UTC insertion/24-hour expiry are
unchanged. No raw live video recording is created.

Stale queued candidates are discarded before analysis. In-flight AI may finish
later; capture time is never replaced by completion time. Task 11 latest still
excludes frames older than its existing 10-second window, even if just saved.
Queue and receiver-to-completion latency therefore remain observable without
claiming old imagery is current camera evidence.

Metrics distinguish decoded frames (including acquisition mailbox replacements),
sampled candidates, queue drops, stale drops, shutdown drops, frames entering
selection, accepted/rejected/failed analyses, stage counts, saved UUIDs, queue
depth, arrivals, save completion, latency and runtime. In a settled successful
run: sampled = sent-to-analysis + queue-dropped + stale-dropped + shutdown-dropped.
ProcessingResult.sampled_frames counts candidates that actually reached Task 13.
Only the most recent 100 outcome/UUID details remain; counters stay complete and
details_truncated signals truncation. Images, recognized private text and vectors
are not printed in operational reports.

## Connection recovery and shutdown

States are DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING, STOPPING, STOPPED
and FAILED. Failed open/read/decoding closes the capture and reconnects using
the same URL/session. Backoff doubles from 1 to at most 15 seconds; a fresh
valid frame resets the delay. Eight reconnect attempts beyond the initial
attempt are allowed by default; the total retry budget does not reset.
There is no unbounded production retry mode. Duration and accepted-frame limits
also apply. Reaching duration without any decoded frame reports FAILED.

OpenCV uses its available FFmpeg backend and requests open/read native timeouts
where supported. If timeout properties are unavailable/rejected, it retries
opening without those properties, still inside the killable subprocess. No
arbitrary backend/transport fallback is used. The parent always watches deadlines
through interruptible IPC. Shutdown requests capture stop, waits briefly, then
terminates/kills ONLY its own child if native code is stalled. This works even
when a backend ignores timeout properties. No GUI window is created.

The acquisition thread closes its source; queued work is dropped and counted.
The analysis thread finishes its current bounded existing provider/DB workflow
before shutdown. It is not killed halfway through a transaction. Ctrl+C can
therefore take longer than the capture timeout while that operation finishes;
existing providers use finite request timeouts (typically up to 30 seconds per
stage) and database operations have finite driver timeouts. HTTP requests remain
in the separately started FastAPI process and are not blocked by this loop.

`start()/stop()/wait()` and blocking `run()` are available. No worker starts on
import or as part of an HTTP request. Reusing a runner instance or starting a
second active runner for that session within the process is rejected. Independent
processes are not coordinated: launching two for one session can duplicate AI
costs and storage. Run one operator-managed process per session; there is no
Redis/Celery infrastructure or claim of cross-process exactly-once processing.

## 1. Locate or install native test tools

Prefer the team's existing MediaMTX installation; don't restart their server.
Check available executables/listeners:

```powershell
Get-Command mediamtx,ffmpeg,ffprobe -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 8554,8889 -State Listen -ErrorAction SilentlyContinue
```

This workspace already has isolated native test tools under ignored
`temp/task14-tools/`. They are not committed. Select them:

```powershell
$mediaExe = (Resolve-Path "temp/task14-tools/mediamtx/mediamtx.exe").Path
$ffmpegExe = (Get-ChildItem "temp/task14-tools/ffmpeg" -Filter ffmpeg.exe -Recurse | Select-Object -First 1).FullName
$ffprobeExe = (Get-ChildItem "temp/task14-tools/ffmpeg" -Filter ffprobe.exe -Recurse | Select-Object -First 1).FullName
& $mediaExe --version
& $ffmpegExe -version | Select-Object -First 1
```

Verified here: MediaMTX v1.21.3, FFmpeg 9.0.2, OpenCV 4.14.0 with FFmpeg backend.
On a teammate's fresh checkout, obtain native Windows AMD64 tools from
[MediaMTX releases](https://github.com/bluenviron/mediamtx/releases) and the
[FFmpeg download page](https://ffmpeg.org/download.html). The following downloads
to ignored local directories without installing services or changing PATH:

```powershell
New-Item -ItemType Directory -Path temp/task14-tools -Force | Out-Null
$release = Invoke-RestMethod "https://api.github.com/repos/bluenviron/mediamtx/releases/latest"
$asset = $release.assets | Where-Object { $_.name -like '*windows_amd64.zip' } | Select-Object -First 1
Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile temp/task14-tools/mediamtx.zip
Expand-Archive temp/task14-tools/mediamtx.zip -DestinationPath temp/task14-tools/mediamtx
Invoke-WebRequest -UseBasicParsing "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile temp/task14-tools/ffmpeg.zip
Expand-Archive temp/task14-tools/ffmpeg.zip -DestinationPath temp/task14-tools/ffmpeg
```

Skip downloads/extraction when tools already exist; use an existing native
installation's paths instead. Docker is not required. No Python dependency
installation or requirements change is needed for Task 14.

## 2. Start an isolated local MediaMTX server

Only if the team is not already using these ports, in terminal A:

```powershell
& $mediaExe ./streaming/mediamtx.local.yml
```

It normally stays running quietly at warning log level. In another terminal:

```powershell
Test-NetConnection 127.0.0.1 -Port 8554
Test-NetConnection 127.0.0.1 -Port 8889
```

Expect TcpTestSucceeded True. The new config is restricted to loopback for
RTSP, signaling and WebRTC media. Anonymous publish/read is permitted ONLY from
loopback IPs and only live UUID-shaped paths. Recording and unused protocols
are disabled. It is an isolated local test config, not a phone/LAN deployment.

The team's existing `mobile/streaming/mediamtx.yml` already allows live paths
but binds wider interfaces and has no explicit authentication section. It was
not weakened or modified. Its owner must configure publisher/reader authorization
and deployment interfaces before using real camera imagery across devices.

## 3. Publish a controlled H.264 pattern without a phone

In terminal B, set the executable path as above, generate one UUID and keep it:

```powershell
$sessionId = [guid]::NewGuid().ToString()
$sessionId
& $ffmpegExe -hide_banner -re -f lavfi -i "testsrc2=size=1280x720:rate=15" -an -c:v libx264 -threads 1 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 15 -rtsp_transport tcp -f rtsp "rtsp://127.0.0.1:8554/live/$sessionId"
```

Expected: FFmpeg continues publishing H.264 frames. To inspect the actual codec
while it runs, in another terminal with the SAME UUID and ffprobe path:

```powershell
$sessionId = "PASTE_THE_UUID_PRINTED_ABOVE"
& $ffprobeExe -v error -rtsp_transport tcp -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate -of json "rtsp://127.0.0.1:8554/live/$sessionId"
```

Expect h264, 1280x720 and approximately 15 FPS for this specific pattern. The
reader also accepts other valid dimensions/rates. A real video alternative is
`-re -stream_loop -1 -i "C:\Videos\sample.mp4"` in place of the lavfi input;
retain explicit H.264 video encoding and `-an`. This follows the official
[MediaMTX FFmpeg RTSP publishing convention](https://mediamtx.org/docs/publish/ffmpeg).

## 4. Run without any paid calls or MySQL

Pure synthetic decoded source, no server at all:

```powershell
.\.venv\Scripts\python.exe -m processing.live_runner --offline-demo --dry-run --duration-seconds 4 --verbose
```

Expected approximate decoded 60, sampled 4, selected 2, rejected 2, saved 0.
Scheduling can affect exact live counts. The deterministic scene sequence is
sharp/duplicate/blurry/changed. `mocked: true` and `receiver_arrival_utc` are
explicit. No provider calls or Database construction occur.

For REAL RTSP frames from terminal B but MOCKED AI, in terminal C:

```powershell
.\.venv\Scripts\python.exe -m processing.live_runner --session-id "$sessionId" --host 127.0.0.1 --port 8554 --rtsp --offline-demo --dry-run --duration-seconds 20 --max-accepted-frames 5 --verbose
```

Expect decoded_frames > sampled_frames, queue depth <= capacity, stage counts,
mocked true and saved 0. Static/blurred scenes may be rejected, so accepted
counts are observations, not guaranteed. Nonzero exit/FAILED is not success.
The default open timeout includes subprocess startup; very slow machines can
increase LIVE_OPEN_TIMEOUT_SECONDS privately. No mock fallback occurs in real
provider mode. A working RTSP connection alone does not prove decoding works.

## 5. Demonstrate disconnect/reconnect

Use mocked analysis for a 60-second controlled test:

```powershell
.\.venv\Scripts\python.exe -m processing.live_runner --session-id "$sessionId" --host 127.0.0.1 --port 8554 --rtsp --offline-demo --dry-run --duration-seconds 60 --max-accepted-frames 20 --verbose
```

In terminal B press q to stop ONLY the synthetic publisher. Wait two seconds,
then rerun its FFmpeg command using the SAME `$sessionId`. The runner detects
failed reads, releases capture, backs off and reconnects. Final JSON should show
increased connection_attempts and successful_reconnections, preserved UUID,
fresh arrivals and later sequence values. If reconnection did not happen, do
not count the demonstration as passed. No actual user's camera is interrupted.
Use the opt-in integration test below for repeatable publisher restart and
deliberately slow-AI queue-backpressure verification.

## 6. Register an owned session and verify real storage

The runner preserves the stream UUID but does not create accounts, start a
phone publisher or invent ownership. A standalone test UUID can store frames,
but HTTP retrieval requires it to belong to the signed-in application account.
Keep the existing account backend on 8002. If it is not running, start it in
another terminal (do not duplicate an existing instance):

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir ../web/ai-backend --host 127.0.0.1 --port 8002
```

Use a dedicated test account, because streams/start closes that account's
earlier live session. These are application signup credentials, not MySQL root:

```powershell
.\.venv\Scripts\python.exe -m database.connection --check
$credential = Get-Credential -Message "Dedicated application test account"
$loginBody = @{ email = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json
$account = Invoke-RestMethod "http://127.0.0.1:8002/api/v1/auth/login" -Method Post -ContentType "application/json" -Body $loginBody -SessionVariable auth
$sessionBody = @{ session_id = $sessionId } | ConvertTo-Json
Invoke-RestMethod "http://127.0.0.1:8002/api/v1/streams/start" -Method Post -ContentType "application/json" -Body $sessionBody -WebSession $auth
```

To store actual RTSP JPEGs with explicitly MOCKED analysis and no paid calls:

```powershell
.\.venv\Scripts\python.exe -m processing.live_runner --session-id "$sessionId" --host 127.0.0.1 --port 8554 --rtsp --offline-demo --execute --duration-seconds 20 --max-accepted-frames 2 --verbose
```

Saved frame IDs must be reported. Synthetic OCR/captions contain MOCK and their
vectors are synthetic, not genuine model outputs. Do not present them as real
analysis. Real MySQL/JPEG integration was tested here with such mocked AI.

## 7. Small explicitly paid real-provider test

Only after verifying private Mistral/OpenAI credentials, billing and an
authorized stream, replace mocked AI with real integrations:

```powershell
.\.venv\Scripts\python.exe -m processing.live_runner --session-id "$sessionId" --host 127.0.0.1 --port 8554 --live --execute --duration-seconds 30 --max-accepted-frames 2 --verbose
```

This allows at most two selected-frame OCR, two combined Vision and two
embedding calls (fewer on rejects/failures/empty metadata). `--live --dry-run`
still incurs AI charges, but saves nothing. Database readiness and key presence
are checked before capture/analysis. No automatic retry or mock substitution
occurs. Saved UUIDs and stage counts show actual results; failures must not be
described as successful AI analysis. Paid live processing was not run during
implementation. An in-flight workflow can finish after duration/cancellation.

## 8. FastAPI, actual JPEGs and search

In another terminal, from multimedia/:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
```

In the terminal retaining `$auth` and `$sessionId`:

```powershell
$base = "http://127.0.0.1:8000"
Invoke-RestMethod "$base/health"
$page = Invoke-RestMethod "$base/api/v1/frames?session_id=$sessionId&limit=20" -WebSession $auth
$page | ConvertTo-Json -Depth 6
if ($page.frames.Count -gt 0) {
    $frameId = $page.frames[0].frame_id
    $imageOut = Join-Path $env:TEMP ("aether-live-" + [guid]::NewGuid().ToString("N") + ".jpg")
    Invoke-WebRequest -UseBasicParsing "$base/api/v1/frames/$frameId/image" -WebSession $auth -OutFile "$imageOut"
    Get-Item -LiteralPath "$imageOut" | Select-Object Name,Length
}
```

Timeline returns actual owned/unexpired records, image returns actual JPEG bytes.
No result means no evidence, not a successful retrieval. Missing/expired/other
users' resources remain 404. Both UTC timestamp/captured_at aliases remain equal.
In Workbench, inspect only the resulting actual UUID:

```sql
SELECT frame_id, session_id, captured_at, source_frame_index, video_timestamp_ms,
       objects, caption, embedding_model, JSON_LENGTH(embedding) AS dimensions,
       created_at, expires_at
FROM multimedia_project.frames
WHERE session_id = 'PASTE_THE_ACTUAL_UUID'
ORDER BY captured_at DESC;
```

Expect NULL live video offsets, 1536 dimensions when embedded, and expiration
24 hours after insertion. Do not expose database credentials or private paths.

The following uses real semantic query embeddings for recent/history when
eligible vectors exist, so it can add up to two paid query requests. Latest
does not call the embedding provider. Use actual visible content in the query:

```powershell
foreach ($mode in @('latest','recent','history')) {
    $body = @{ session_id = $sessionId; query = 'Describe something actually visible in the test'; mode = $mode; limit = 5 } | ConvertTo-Json
    Invoke-RestMethod "$base/api/v1/search" -Method Post -ContentType "application/json" -Body $body -WebSession $auth
}
```

HTTP search still requires all four fields including limit. Latest may be empty
when no retained observation arrived within 10 seconds; never substitute an old
frame as current evidence. Standard automated tests use mocked query embeddings.

## 9. Actual phone and Member 2 handoff

This complete three-member demonstration has NOT been verified here. Coordinate
with the owners without changing their code:

1. Member 1 runs the PWA in a camera-capable secure context, logs in, starts an
   owned session and shares its actual UUID. Confirm WHIP publishes to the agreed
   path on the actual team MediaMTX server. Verify negotiated H.264/decodability.
2. Member 3 first runs `--rtsp --offline-demo --dry-run` with that UUID and the
   actual configured host, then the small explicit paid command after agreement.
   Confirm real analysis/UUIDs/JPEGs using the timeline and image commands.
3. Member 2 uses the same UUID for WHEP playback and multimedia search. Their
   examples currently use port 8003; either run the multimedia server on 8003
   with `--port 8003`, or have Member 2 set their existing MULTIMEDIA_API_URL and
   VITE_MULTIMEDIA_API_URL to the chosen 8000 base. Their
   VITE_MEDIA_WHEP_BASE_URL must point to the actual MediaMTX signaling origin.
   Preserve authentication cookie forwarding and session ownership; CORS alone
   does not authorize requests. Use one hostname consistently for login cookies.
4. Ask a question about actually visible text/objects. Check latest/recent/history,
   a retrieved JPEG and the frame IDs supporting the answer. No retrieved evidence
   must yield uncertainty, never a fabricated answer or safety guarantee. Verify
   question history and speech through the respective owners' components.

The checked-in Member 2 assistant.py/history.py are currently docstring stubs,
and its backend main.py registers only authentication and stream routers, not
ask/history. Question answering/history/speech completion is therefore an open
team handoff requirement, not a passed Task 14 end-to-end demonstration. Its
owners need to complete/verify those parts; this task does not implement them.

For an actual phone/LAN deployment, loopback addresses are not reachable from
the phone. Obtain the server's real LAN address (`ipconfig`) and use the team's
approved deployment config, HTTPS/secure-context setup and authorization.
WebRTC also needs reachable media ICE candidates/8189 UDP (or the team's
configured ICE/TURN/TCP alternative), not just signaling 8889. Scope any Windows
firewall rule to the private network/device subnet with the server owner's
approval. No firewall rule, TLS termination, browser secret or production auth
relaxation was added by Member 3. Do not expose anonymous real camera streams.

## 10. Test commands and shutdown

Offline reader tests:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
.\.venv\Scripts\python.exe -m pytest tests/test_live_stream.py -v --basetemp "$pytestTemp" -p no:cacheprovider
```

Offline runner tests:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
.\.venv\Scripts\python.exe -m pytest tests/test_live_pipeline.py -v --basetemp "$pytestTemp" -p no:cacheprovider
```

Actual RTSP tests start/stop their OWN loopback MediaMTX on a free port and
synthetic FFmpeg publishers. They do not restart a teammate's server or require
a phone. Set native paths, then opt in:

```powershell
$env:MEDIAMTX_EXECUTABLE = $mediaExe
$env:FFMPEG_EXECUTABLE = $ffmpegExe
$env:RUN_LIVE_TESTS = '1'
# Include the two actual database scenarios; omit this for MediaMTX-only tests.
$env:RUN_MYSQL_TESTS = '1'
try {
    $pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
    .\.venv\Scripts\python.exe -m pytest tests/test_live_integration.py -v --basetemp "$pytestTemp" -p no:cacheprovider
} finally {
    Remove-Item Env:\RUN_LIVE_TESTS,Env:\RUN_MYSQL_TESTS,Env:\MEDIAMTX_EXECUTABLE,Env:\FFMPEG_EXECUTABLE -ErrorAction SilentlyContinue
}
```

Without flags, tests explicitly skip. With flags, missing tools/services cause
failures, not fake passes. No real paid requests occur. Database tests remove
only their own unique rows/JPEGs and never run destructive global retention.
For the full regression, use `tests/` in the same command. Without flags:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
.\.venv\Scripts\python.exe -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider
```

Stop your runner with Ctrl+C, publisher with q, and only your own MediaMTX and
Uvicorn terminals with Ctrl+C. End the dedicated owned test session:

```powershell
Invoke-RestMethod "http://127.0.0.1:8002/api/v1/streams/stop" -Method Post -ContentType "application/json" -Body $sessionBody -WebSession $auth
Get-Process mediamtx,ffmpeg,python -ErrorAction SilentlyContinue | Select-Object Name,Id,StartTime
```

Compare with recorded process IDs/start times; unrelated Python/Uvicorn/MySQL
services may legitimately remain. Never kill all Python processes. Test fixtures
join their owned processes and the reader terminates only its own child.
No permanent live worker was left running during implementation.

Task 13 retention remains a separate explicit worker; frames remain inaccessible
after expiry even if it is stopped. Start one managed cleanup process only when
global expired-resource deletion is intended:

```powershell
.\.venv\Scripts\python.exe -m database.retention --worker --interval-minutes 15 --execute
```

See [Task 13 recovery and dry-run guidance](PIPELINE.md). No changes to retention,
face recognition, identity inference or safety assertions are introduced here.

References: [MediaMTX publishing](https://mediamtx.org/docs/publish/ffmpeg),
[configuration](https://mediamtx.org/docs/references/configuration-file),
[authentication](https://mediamtx.org/docs/features/authentication) and
[OpenCV timeout properties](https://docs.opencv.org/4.13.0/d4/d15/group__videoio__flags__base.html).

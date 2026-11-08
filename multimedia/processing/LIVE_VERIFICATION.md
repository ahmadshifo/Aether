# Task 14 implementation and verification — 2026-11-07

Member 3 live-stream processing is implemented and verified with real native
MediaMTX, H.264 FFmpeg publishing, OpenCV, MySQL and private JPEG storage.
The full three-member mobile/dashboard/answering demonstration remains unverified.
Paid provider calls were not made. No commit or push was performed.

## Files changed by Task 14

Paths are relative to multimedia/. Earlier Task 10-13/auth changes were already
uncommitted before this task and are not attributed to Task 14.

| File | Responsibility |
| --- | --- |
| `processing/live_settings.py` (new) | Trusted existing RTSP template, UUID/path/config validation, finite timeouts/retry/rate/queue/runtime budgets and private dotenv loading |
| `processing/live_stream.py` (new) | LiveFrame metadata, isolated FFmpeg VideoCapture child, bounded IPC, optional native timeouts plus mandatory parent watchdog, reconnect/state/resource control |
| `processing/live_runner.py` (new) | Monotonic sampler, bounded oldest-drop queue, one analysis worker, stale drops, cancellation, counters, in-process session guard and explicit CLI |
| `processing/live_demo.py` (new) | Explicit synthetic decoded source for no-server/no-DB/no-paid-call demonstrations |
| `processing/pipeline.py` (extended) | `process_live_frame()` adapter reusing the Task 13 workflow; optional video-time mapping preserves local-video defaults and stores NULL for live video offsets |
| `streaming/mediamtx.local.yml` (new) | Loopback-only native test server, local-only publish/read permissions, agreed live path, no recording or unused public listeners |
| `api/.env.example` (appended) | Live timeout/rate/queue/retry/test defaults; reuses RTSP_STREAM_URL instead of introducing a conflicting host/path configuration |
| `tests/test_live_stream.py` (new) | 42 offline reader/config/reconnect/native-fallback/process-stop tests |
| `tests/test_live_pipeline.py` (new) | 51 offline runner/backpressure/staleness/analysis/failure/shutdown tests |
| `tests/test_live_integration.py` (new) | Six owned native server/publisher tests; four without MySQL, two with actual MySQL/HTTP |
| `processing/LIVE.md` (new) | Exact Windows installation/startup/test/stop instructions, operational policies and three-member handoff |
| `processing/LIVE_VERIFICATION.md` (new) | This implementation report, actual results and Git status |
| `README.md` (updated) | Task 14 guide/report links |

Temporary native tools were downloaded into the ignored temp/task14-tools folder,
not installed as system services or committed. A temporary diagnostic script/log/
config and unused alternative wheel were removed afterward. Existing private
api/.env, database schema/requirements, API routes/schemas/security/search,
retention, mobile/, web/, shared/contracts/ and root deployment files were not
modified by Task 14. Older web/auth modifications remain in the working tree.

## Architecture, URLs and reuse

Mobile publishes WHIP to MediaMTX; Python reads RTSP/TCP; dashboard uses WHEP.
All use live/{session_id}. The trusted configured host and actual UUID determine:

- `http://MEDIA_HOST:8889/live/{session_id}/whip`
- `rtsp://MEDIA_HOST:8554/live/{session_id}`
- `http://MEDIA_HOST:8889/live/{session_id}/whep`

Actual HTTPS termination/ports follow team deployment. The existing mobile
publisher prefers H.264 but actual device negotiation was not tested here.
Incoming dimensions/FPS may vary; no audio access, GUI or raw recording is needed.

Capture runs in one spawned subprocess, continuously decoding into a one-item
IPC mailbox. An acquisition thread samples arrivals by monotonic time into a
bounded queue (default three). A single analysis thread reuses Task 13's live
frame adapter and Tasks 6-10, with no duplicate filters or provider wrappers:
FrameSelector -> OCRResult -> combined VisionResult/caption -> Task 9 description
and embedding -> Task 10 validation/save_frame -> private JPEG and MySQL JSON.
Rejected frames never call providers or storage. Empty descriptions retain NULL
embedding/model. Failures follow Task 13's no-partial-analysis-row policy.

Frame metadata preserves session UUID, increasing decoded sequence, receiver
arrival UTC, monotonic arrival and connection segment. Arrival time is explicitly
not the camera's original capture timestamp. Monotonic elapsed time is used only
for selection; database video_timestamp_ms is NULL for live frames. Insertion
and 24-hour expiry remain database-based. Saved frame UUIDs come from the existing
repository, with no replay of failed analysis on reconnect.

## RTSP recovery, queue and shutdown

FFmpeg is the required available OpenCV backend, with TCP transport. Native open/
read timeout properties are requested when supported; rejected/unavailable
properties fall back only within the isolated process. The parent always uses
interruptible deadlines and can terminate/kill its OWN stalled native child.
Optional OpenCV logging APIs are checked for availability (this installed build
does not provide setLogLevel). Native stderr is suppressed in the dedicated
child to prevent authenticated URL exposure; reports retain safe failure codes.

Connection/read/decoding failures release capture and enter bounded reconnection
using the same URL/session. Backoff defaults 1 second, caps at 15, and reconnect
budget defaults eight beyond the initial attempt. State/attempt/reconnection
counts remain observable. Cancellation also interrupts backoff/IPC waits.

Old pending candidates are dropped on queue pressure; stale candidates are
discarded before selection. No unbounded image queue, parallel paid calls or
shared SQLAlchemy Session exists. Selector state persists across reconnects.
Provider auth/config/quota, fatal storage outcomes or repeated ordinary analysis
failures fail explicitly. Runtime and accepted-frame budgets limit first tests.
Finishing a duration without any decoded frame is a failure, not silent success.

Shutdown stops acquisition, accounts for queued drops and joins workers. The
current existing AI/DB operation finishes without killing a transaction. Its
finite provider/driver timeouts may make graceful shutdown longer than capture
shutdown. Operational details are capped at the latest 100 outcomes/frame IDs;
counters remain complete. No hidden worker starts on import or in FastAPI.

The in-process session registry rejects duplicate active runners for a session.
Independent processes are NOT coordinated and can duplicate costs/storage; the
documented initial operation is one explicitly managed process per session.
There is no cross-process exactly-once claim or new messaging infrastructure.

## Actual test results

| Executed suite | Passed | Failed | Errors | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Offline RTSP reader | 42 | 0 | 0 | 0 |
| Offline live pipeline | 51 | 0 | 0 | 0 |
| Actual MediaMTX/FFmpeg integration, including MySQL | 6 | 0 | 0 | 0 |
| Full default multimedia regression | 871 | 0 | 0 | 79 |
| Full regression, RUN_LIVE_TESTS=1 and RUN_MYSQL_TESTS=1 | **949** | **0** | **0** | **1** |

All 850 previous passing Task 1-13/auth tests remained passing, plus 99 new
Task 14 cases. The one skip is the existing retention test requiring Windows
privileges to create a real symlink. Nonprivileged redirected-path/traversal
safety tests passed. Default-suite skips explicitly opt out of MySQL/live
integration plus that one OS-privilege case.

The existing upstream Starlette TestClient/httpx deprecation warning remains
one warning, not a failure. No package upgrade was made to hide it.
`pip check` reported no broken requirements. Syntax/whitespace checks and
`git diff --check` passed (ordinary existing Git LF/CRLF notices remain).

Verified native versions: Python 3.13.7, OpenCV 4.14.0 with FFmpeg backend,
MediaMTX v1.21.3, FFmpeg 9.0.2 and native MySQL 8.0.43. The previously approved
MySQL 8.0.17+/8.4 compatibility behavior was preserved; MySQL 8.4 was not
separately run or installed. No table reset/schema rewrite occurred.

Full regression logs in the Windows temporary directory:

- `aether-pytest-9da2aca6f6f34b699d4e5ee9fc23a9cd.log`: default, 871 passed,
  79 skipped, 31.72 seconds.
- `aether-pytest-048cd2f635a14035ac20bf821706690e.log`: both opt-in flags,
  949 passed, 1 skipped, 91.40 seconds.

## Actual native stream/MySQL scenarios

Integration fixtures started their own loopback-only MediaMTX on a free port,
used unique session UUIDs and launched actual FFmpeg H.264 testsrc2 publishers
at 320x240/15 FPS. They joined only their owned publisher/server/capture processes.
They did not restart any teammate service. All six scenarios passed:

1. OpenCV decoded real H.264 frames, preserved session/arrival/sequence and
   released its subprocess/source.
2. Actual live sampling/Task 13 selection with mocked AI and no MySQL produced
   analyses while leaving saved count zero.
3. The publisher stopped and restarted on the same path. The reader reconnected
   with the same UUID, a new segment, later sequence and fresh arrival timestamp.
4. A deliberately slow mock OCR call left acquisition running. A one-candidate
   queue dropped old work, stayed bounded and reconciled drop/analysis counts.
5. Actual MySQL/JPEG persistence retained JSON vectors of length 1536, NULL live
   video offsets and 24-hour insertion-based expiry. Task 11 history and existing
   authenticated Task 12 timeline/image/search served those actual stored frames;
   session isolation and unique saved IDs were checked.
6. After an actual publisher interruption/restart, the existing selector was
   preserved and a genuine monotonic coverage gap allowed a fresh saved frame.
   No analysis retry created a duplicate UUID or session.

MySQL fixtures used generated synthetic accounts/sessions and temporary JPEG
directories, cleaned only generated records and never executed global retention.
OCR/Vision/embedding responses and semantic query vectors were mocked throughout.
Actual frames and database operations were real; these tests do not claim paid
provider availability/billing success.

## CLI verification outside pytest

An owned native server/publisher plus the actual `processing.live_runner` CLI
ran without MySQL/paid providers. One observed run reported STOPPED, 34 decoded,
2 sampled, 2 sent to selection and queue depth zero. Counts are observations,
not promised live timing. The owned server/publisher were stopped afterward.

The four-second purely synthetic CLI reported 57 decoded, 4 sampled, 2 selected,
2 rejected, 0 saved and 0 failures. All reports explicitly identified mocked
analysis and receiver-arrival timestamp semantics. `--verbose` displayed safe
progress metrics and the final report. Native mediamtx/ffmpeg process inspection
after testing showed none left running. No permanent live/retention worker was
started. Temporary capture children were joined/terminated by their owners.

Native test tools are ignored by Git. Downloaded archive SHA-256 values were:

- MediaMTX ZIP: `b2f5246b07cb72961df03b8d5e8cad43dc657bcf3f49a87bb031bdf22721af74`
- FFmpeg ZIP: `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`

These record local download integrity; they are not a claim of separately
verified upstream signatures. MediaMTX came from its official GitHub release;
FFmpeg came from the Gyan Windows distribution linked through its download
ecosystem. No executable or archive is staged for Git.

## API/team compatibility and remaining handoff

No endpoint or public schema changed. Search still requires session_id, query,
mode and limit. Existing timestamp/captured_at equality, relevance score,
relative authorized image URLs, cookies/ownership and expiry checks remain.
Task 11 latest still excludes old captures even if AI finishes processing later.
Receiver-to-completion latency is observable but cannot prove true camera latency.

The actual three-member demonstration was NOT performed. The checked-in
Member 2 assistant.py and history.py are docstring stubs; web backend main.py
registers auth and stream routers only. Ask/history/speech and real mobile
WHIP/dashboard WHEP/grounded answers therefore remain a team handoff requirement.
Their code was not modified. The exact shared-UUID, authenticated timeline/image,
latest/recent/history, grounded-answer and speech procedure is in
[the Windows live guide](LIVE.md).

Member 2's current example multimedia base URLs use port 8003, while our explicit
development examples use 8000. The guide explains selecting one port consistently
without silently rewriting teammate configuration. Account ownership and cookie
forwarding remain necessary. Do not treat CORS or knowing a UUID as authorization.

Paid Mistral/OpenAI requests were NOT executed. The guide provides an explicit
small `--live --execute --max-accepted-frames 2` test; its success depends on
private credentials, quota, billing and actual provider availability. A live
dry-run still incurs provider calls. No real camera imagery was used in these
implementation tests and no successful assistant answer was fabricated.

## Security and deployment limits

Only selected frames are stored; no full video recording, identity recognition,
face recognition or unsupported safety claims are introduced. Existing private
image storage/API authorization and Task 13 24-hour retention remain effective.
No API accepts arbitrary RTSP URLs. Stream URLs/credentials/private OCR content
are omitted from operational reports.

The new native config is a loopback-only test environment. Anonymous permissions
are restricted to loopback and live UUID-shaped paths; unused protocols and
recording are disabled. The existing team mobile MediaMTX config binds broader
interfaces and has no explicit auth section; its owner must review authorization
before exposing real imagery. It was not disabled/changed by this task.
Actual phone deployment additionally needs the genuine LAN/server address,
camera-capable secure context, appropriate HTTPS/CORS/ICE/TURN/network routing
and scoped firewall access. No global firewall or production auth change was made.
See official [MediaMTX authentication guidance](https://mediamtx.org/docs/features/authentication).

## Git state

Current branch: `feature/multimedia`. No commit, staging, push or merge was
performed. The snapshot below includes older uncommitted work present before
Task 14; only the file table above describes changes made by this task.

```text
 M multimedia/README.md
 M multimedia/api/.env.example
 M multimedia/api/Dockerfile
 M multimedia/api/app/main.py
 M multimedia/api/app/routes.py
 M multimedia/api/app/schemas.py
 M multimedia/api/app/search_service.py
 M multimedia/api/requirements.txt
 M multimedia/database/README.md
 M multimedia/database/VERIFICATION.md
 M multimedia/database/compose.db.yml
 M multimedia/database/connection.py
 M multimedia/database/models.py
 M multimedia/database/repository.py
 M multimedia/database/schema.py
 M multimedia/database/schema.sql
 M multimedia/processing/pipeline.py
 M multimedia/tests/test_database.py
 M multimedia/tests/test_database_integration.py
 M web/README.md
 M web/ai-backend/.env.example
 M web/ai-backend/app/auth.py
 M web/ai-backend/requirements.txt
?? multimedia/.dockerignore
?? multimedia/api/API_VERIFICATION.md
?? multimedia/api/README.md
?? multimedia/api/SEARCH.md
?? multimedia/api/SEARCH_VERIFICATION.md
?? multimedia/api/__init__.py
?? multimedia/api/dependencies.py
?? multimedia/api/errors.py
?? multimedia/api/main.py
?? multimedia/api/routes.py
?? multimedia/api/schemas.py
?? multimedia/api/search_demo.py
?? multimedia/api/search_service.py
?? multimedia/api/security.py
?? multimedia/api/settings.py
?? multimedia/database/retention.py
?? multimedia/processing/LIVE.md
?? multimedia/processing/LIVE_VERIFICATION.md
?? multimedia/processing/PIPELINE.md
?? multimedia/processing/TASK13_VERIFICATION.md
?? multimedia/processing/live_demo.py
?? multimedia/processing/live_runner.py
?? multimedia/processing/live_settings.py
?? multimedia/processing/live_stream.py
?? multimedia/processing/pipeline_demo.py
?? multimedia/scripts/demo_api_data.py
?? multimedia/scripts/demo_retention.py
?? multimedia/scripts/demo_search.py
?? multimedia/streaming/
?? multimedia/tests/test_api.py
?? multimedia/tests/test_api_integration.py
?? multimedia/tests/test_auth_database_integration.py
?? multimedia/tests/test_live_integration.py
?? multimedia/tests/test_live_pipeline.py
?? multimedia/tests/test_live_stream.py
?? multimedia/tests/test_pipeline.py
?? multimedia/tests/test_pipeline_integration.py
?? multimedia/tests/test_retention.py
?? multimedia/tests/test_search_integration.py
?? multimedia/tests/test_search_service.py
?? web/dashboard/node_modules/
```

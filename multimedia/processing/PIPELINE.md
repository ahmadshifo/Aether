# Task 13: multimedia pipeline and automatic retention

All commands use PowerShell and the project's virtualenv directly. From the
project root, first enter the multimedia directory:

```powershell
Set-Location "C:\Users\Technoline\Desktop\multimedia-project\multimedia"
```

The private `api/.env` is preserved and remains ignored by Git. Process
environment overrides dotenv, without interpolation. No packages or database
tables were added. The previously approved native MySQL 8.0.43 remains supported,
alongside MySQL 8.4 LTS. This task does not upgrade the database server.

## Flow and reuse

`MultimediaPipeline.process_video()` opens Task 3's `FrameExtractor` in a context
manager. It reuses Task 2's `VideoReader.open()`, `get_metadata()` and
`read_frame()`. Sampling selects frame zero then the first frame at/after each
target interval. Task 13 requires at least one second between sample targets;
there is no alternative sampling algorithm. FPS-based timing remains approximate
for variable-frame-rate video.

Each `ExtractedFrame` goes through Task 6's `FrameSelector.evaluate()` once.
That already calls Task 4's `evaluate_quality()` and Task 5's `DuplicateFilter`.
Reasons stay `first_frame`, `new_scene`, `periodic_frame`, `blurry`, `duplicate`.
Rejected frames trigger no AI, repository insert or JPEG persistence.

For accepted frames:

1. Task 7's `OCRService.extract_text(image)` returns `OCRResult.text`, preserving
   Arabic/English and meaningful line breaks. Successful no-text OCR is success.
2. Task 8's `VisionService.analyze_image(image)` returns objects, caption, model
   and uncertainty. `get_caption(result)` reads the SAME result, without another
   provider call. Uncertainty is retained in the frame outcome; the existing
   database schema has no separate uncertainty column. No invented scores/boxes.
3. Task 9's `build_frame_description()` joins Scene/Objects/Visible text.
   `EmbeddingService.embed_frame()` generates the existing
   `text-embedding-3-small` vector. Task 10's `validate_embedding()` checks model,
   1536 real finite values and a nonzero vector. An empty description skips the
   embedding call and stores SQL NULL for embedding and model.
4. Task 10's `FrameRepository.save_frame()` writes the exclusive UUID JPEG and
   inserts metadata using its existing rollback/consistency behavior. It returns
   the saved UUID. Rejected images and raw video copies are never persisted.

The existing provider instructions stay unchanged: no face recognition, identity
inference, invented observations or claims that a scene is safe.

## Reusable interface and results

```python
from processing.pipeline import MultimediaPipeline, PipelineSettings

pipeline = MultimediaPipeline(
    ocr_service=ocr, vision_service=vision, embedding_service=embedding,
    repository=repository, settings=PipelineSettings(1, 5),
)
result = pipeline.process_video(video_path, session_id,
                                recording_start=aware_recording_start)
print(result.to_dict())
```

The constructor also accepts a selector and extractor factory for injection.
`process_frame(extracted_frame, session_id, captured_at=aware_datetime,
dry_run=False)` provides reusable selection/analysis/persistence for an already
decoded frame. The caller manages selector reset and sequential timestamps.
Instances are sequential and dependencies are caller-owned. Task 14 RTSP and
MediaMTX integration is not implemented.

Reports contain decoded/sample/selected/rejected/saved/failed/analyzed counts,
selection failures, rejection reasons, per-stage successes/failures/skips,
duration, saved UUIDs and frame outcomes. `--verbose` includes safe frame-level
statuses, uncertainty and error class names; never private OCR/image contents,
vectors, provider bodies, credentials or internal paths.

`sampled = selected + rejected + selection_failures`. Selected frames can fail
analysis or storage. `saved_frames` counts completed persistence; dry-run
successes count as `analyzed_frames`, not saved frames. Stage counts cover only
attempted or explicitly skipped stages. Decoded count is the reader's actual
count before EOF/sample limit, not the advertised total video length.

Selection resets per video. Reprocessing generates fresh frame UUIDs, so it can
create additional records. Deduplication is within-run, not cross-run idempotency.
Omitting the session UUID generates one UUID for the run. Standalone UUIDs do
not grant HTTP access; Task 12 requires a session owned by the signed-in account.

## Time and failures

Capture time is the timezone-aware recording start plus video milliseconds,
normalized to UTC. If the original recording time is unavailable, the run's
UTC start plus video offset is explicitly labelled
`run_start_plus_video_offset_substitute`; it is not original capture time.
Fast offline processing may produce future capture times initially; existing
search/timeline exclude them until their timestamp arrives. Supply a known
recording start, or an explicitly labelled demonstration start in the past, for
immediate retrieval. Source index and video milliseconds remain separate;
fractional milliseconds use the repository's half-up integer rounding.
`created_at` is insertion time; expiration is **24 hours after insertion**,
independent of the recording's age. Non-24-hour repository configuration is
rejected by this pipeline.

| Failure | Policy |
| --- | --- |
| OCR/Vision/embedding request or malformed result | Report failed stage; skip persistence; continue with later frames |
| Successful empty OCR | Continue with empty text, counted as success |
| Successful empty metadata | Save accepted JPEG with empty metadata and NULL embedding/model |
| Provider configuration/authentication/quota error | Stop the run to avoid repeated failed calls |
| JPEG write or ordinary repository insertion error | Report storage failure; reuse rollback/cleanup; continue later frames |
| Database connection or storage consistency uncertainty | Stop; retain the repository's recovery evidence |
| Missing/empty/corrupt/no-decodable-frame video | Controlled fatal report; nonzero CLI exit |

No partial-analysis rows or pipeline retries are added. Each accepted frame
causes at most one call per existing provider service. Resources close at EOF,
limits, errors and interruption. OpenCV cannot reliably distinguish normal EOF
from a decode failure in the middle of a video; decoded counts remain actual.

## Configuration and explicit modes

Only optional defaults were appended to the established `.env.example`:

```dotenv
PIPELINE_SAMPLE_INTERVAL_SECONDS=1
PIPELINE_MAX_TEST_FRAMES=5
RETENTION_BATCH_SIZE=100
RETENTION_CLEANUP_INTERVAL_MINUTES=15
```

Existing storage/retention/database/provider/embedding/API names remain intact.
`--interval` and `--max-frames` override pipeline settings. Max counts sampled
frames, including rejects, bounding potential charges. CLI defaults to no
persistence; `--execute` explicitly enables it. Choose `--offline-demo` or
`--live` explicitly. **`--live --dry-run` still makes paid AI calls**, but writes
no rows/JPEGs. Pure offline dry-run does not construct a Database.

## Manual A: offline processing

Create a new real four-second MJPG video containing sharp, duplicate, blurry and
changed samples. The generator refuses an existing destination:

```powershell
$demoVideo = Join-Path $env:TEMP ("aether-video-" + [guid]::NewGuid().ToString("N") + ".avi")
.\.venv\Scripts\python.exe -m processing.pipeline_demo --output "$demoVideo"
.\.venv\Scripts\python.exe -m processing.pipeline --video "$demoVideo" --offline-demo --dry-run --verbose
```

Expected fixture counts: decoded 40, sampled 4, selected 2, rejected 2 (one
duplicate, one blurry), analyzed 2, saved 0, failed 0. Flags are `mocked: true`
and `dry_run: true`. Decisions are first_frame, duplicate, blurry, new_scene.
Synthetic OCR/captions/vectors are explicitly mocked, never actual AI analysis.
No MySQL, internet, paid calls or teammate service is needed.

## Manual B: controlled real-provider processing

This optional procedure **was not executed during implementation**. Configure
private keys/billing first, and use a short local video authorized for cloud
analysis. Keep the existing account backend running on 8002 (see
[Task 12's guide](../api/README.md)). Use a dedicated application test account;
the existing streams/start route closes earlier live sessions for that account.

```powershell
.\.venv\Scripts\python.exe -m database.connection --check
$credential = Get-Credential -Message "Dedicated application test account email/password"
$loginBody = @{ email = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json
$account = Invoke-RestMethod "http://127.0.0.1:8002/api/v1/auth/login" -Method Post -ContentType "application/json" -Body $loginBody -SessionVariable auth
$sessionId = [guid]::NewGuid().ToString()
$sessionBody = @{ session_id = $sessionId } | ConvertTo-Json
Invoke-RestMethod "http://127.0.0.1:8002/api/v1/streams/start" -Method Post -ContentType "application/json" -Body $sessionBody -WebSession $auth

$video = "C:\Videos\YOUR_SHORT_AUTHORIZED_VIDEO.mp4"
# Labelled demonstration substitution, not original recording time.
$demoStart = [DateTimeOffset]::UtcNow.AddHours(-1).ToString("o")
.\.venv\Scripts\python.exe -m processing.pipeline --video "$video" --session-id "$sessionId" --recording-start "$demoStart" --live --execute --max-frames 2 --verbose
```

Replace the path with a real file. This permits at most two OCR, two combined
Vision and two embedding requests, fewer for rejects/failures/empty metadata.
Database readiness is checked before billable work. Do not rerun inadvertently:
it can incur additional charges. JSON reports actual UUIDs/stages; an empty
frame list is not successful persistence. Exit codes: 0 success, 1 reported
failure, 130 interruption, 2 argparse usage error.

For mocked analysis plus actual MySQL, replace `--live` with `--offline-demo`
and keep `--execute`. Persisted OCR/captions remain MOCK-labelled; vectors are
synthetic and must not be presented as real model-generated embeddings.

## Manual C-D: history search and HTTP

History search can incur one additional paid query-embedding request:

```powershell
.\.venv\Scripts\python.exe -m api.search_service --session-id "$sessionId" --query "Describe something actually visible in the test video" --mode history --limit 5 --json
```

Use a query relevant to actual stored metadata. Empty results do not establish
a match. Start multimedia in a separate terminal from `multimedia/`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
```

In the terminal holding `$auth` and `$sessionId`:

```powershell
$base = "http://127.0.0.1:8000"
Invoke-RestMethod "$base/health"
$page = Invoke-RestMethod "$base/api/v1/frames?session_id=$sessionId&limit=20" -WebSession $auth
$page | ConvertTo-Json -Depth 6
if ($page.frames.Count -gt 0) {
    $frameId = $page.frames[0].frame_id
    $imageOut = Join-Path $env:TEMP ("aether-retrieved-" + [guid]::NewGuid().ToString("N") + ".jpg")
    Invoke-WebRequest -UseBasicParsing "$base/api/v1/frames/$frameId/image" -WebSession $auth -OutFile "$imageOut"
    Get-Item -LiteralPath "$imageOut" | Select-Object Name,Length
}
$body = @{ session_id = $sessionId; query = "Your actual test query"; mode = "history"; limit = 5 } | ConvertTo-Json
Invoke-RestMethod "$base/api/v1/search" -Method Post -ContentType "application/json" -Body $body -WebSession $auth
```

Health returns status ok; owned unexpired nonfuture timeline records return
metadata; valid images return image/jpeg; expired/missing/inaccessible images
return 404. Search still requires all four fields, including **limit** (omission
returns 422). Both identical UTC `timestamp` and `captured_at` remain. No raw
path/vector or unauthenticated private camera imagery is exposed.
Stop only this dedicated test session afterward:

```powershell
Invoke-RestMethod "http://127.0.0.1:8002/api/v1/streams/stop" -Method Post -ContentType "application/json" -Body $sessionBody -WebSession $auth
```

## Retention implementation and recovery

`cleanup_expired_frames(repository, now_utc=None, batch_size=100, dry_run=True)`
uses one fixed aware UTC deadline. SQL selects `expires_at <= deadline`, ordered
by expiry then UUID, using bounded keyset pages. Only ID/expiry is loaded.
Failed records advance the keyset, preventing infinite loops. Error details
are capped at 100 while counters cover all records. Optional session scope
supports controlled tests; ordinary retention applies globally across sessions.

A MySQL connection-owned advisory lock keyed by database serializes cleanup
cycles across workers/pools/processes. Contention reports failure and stops the
cycle. The existing repository deletion obtains FOR UPDATE and rechecks expiry
under that row lock, protecting concurrent deletes/expiry edits. SQLAlchemy
Sessions are per operation, never shared. The advisory connection is explicitly
released, or invalidated on uncertain release.

`delete_expired_frame()` shares the existing safe-delete implementation:
validate the exact UUID-derived path under the storage root, quarantine the
JPEG, delete/flush/commit the row, then unlink quarantine. Traversal, redirected
symlinks, arbitrary paths and recursive root deletion are rejected. A missing
JPEG permits removal of its expired row and increments `missing_files`, not
`files_deleted`. Precommit failure rolls back and restores the moved JPEG.
Uncertain commit or failed postcommit unlink preserves recovery evidence and
stops cleanup with a failure; no clean deletion is claimed. Inspect the UUID
and hidden quarantine JPEG locally before recovery. No orphan sweeper guesses
what to delete. Keep the configured storage root unchanged while retaining
records; a wrong root would appear as missing JPEGs.

Reports separate eligible records, completed row/file deletes, missing files,
skipped concurrent changes, failures and stopped cycles. Dry-run counts
eligible rows without writes/deletion; it cannot promise future unlink success.
Task 11/12 expiry exclusions work even if cleanup is stopped.

## Manual E-F: preview and controlled execution

Global preview (also the default action):

```powershell
.\.venv\Scripts\python.exe -m database.retention --once --dry-run
```

For deletion verification, seed only synthetic test records with a unique
session and scope execution to it. The helper creates one expired and one
unexpired actual row/JPEG and never modifies unrelated data:

```powershell
$fixture = .\.venv\Scripts\python.exe -m scripts.demo_retention --seed | ConvertFrom-Json
try {
    .\.venv\Scripts\python.exe -m database.retention --once --dry-run --session-id "$($fixture.session_id)"
    .\.venv\Scripts\python.exe -m database.retention --once --execute --session-id "$($fixture.session_id)"
    .\.venv\Scripts\python.exe -m scripts.demo_retention --verify --session-id "$($fixture.session_id)" --expired-frame-id "$($fixture.expired_frame_id)" --retained-frame-id "$($fixture.retained_frame_id)"
} finally {
    .\.venv\Scripts\python.exe -m scripts.demo_retention --remove-test-data --session-id "$($fixture.session_id)" --expired-frame-id "$($fixture.expired_frame_id)" --retained-frame-id "$($fixture.retained_frame_id)"
}
```

Expected: preview finds 1, deletes 0; execute deletes 1 row/1 JPEG, failures 0;
verification reports both checks true; fixture cleanup deletes the remaining
one. The helper checks session/UUIDs/marker and refuses non-fixture metadata.
Its standalone test session is not HTTP-owned.

## Periodic automatic execution

Run one managed foreground worker in a separate terminal:

```powershell
.\.venv\Scripts\python.exe -m database.retention --worker --interval-minutes 15 --execute
```

This explicitly enables global expired-resource deletion. It reports each
cycle, runs immediately, then waits interruptibly. Ctrl+C closes it cleanly.
Run only one worker; the advisory lock also serializes accidental concurrent
cycles. No worker starts on import or with FastAPI, HTTP requests are not
blocked, and no AI calls occur. The worker or external scheduler must stay
active for automatic physical deletion. `--worker --dry-run` previews instead.
Coordination/infrastructure/consistency failures stop with exit 1. Ordinary
per-record failures are reported and retried next cycle. No cloud scheduler or
Task 14 streaming component is added.

## Manual G-H and automated tests

The real integration suite verifies persistence through a separate connection,
expiry filtering through Task 11/12, actual JPEG deletion and a test-controlled
MySQL flush failure with rollback/JPEG restoration. It uses actual extraction,
selection, repository, MySQL and HTTP routes, with only AI results mocked.
It cleans only generated rows/files, never resets or drops tables.

```powershell
$env:RUN_MYSQL_TESTS = "1"
try {
    $pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
    .\.venv\Scripts\python.exe -m pytest tests/test_pipeline_integration.py -v --basetemp "$pytestTemp" -p no:cacheprovider
} finally {
    Remove-Item Env:\RUN_MYSQL_TESTS -ErrorAction SilentlyContinue
}
```

Offline pipeline tests:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
.\.venv\Scripts\python.exe -m pytest tests/test_pipeline.py -v --basetemp "$pytestTemp" -p no:cacheprovider
```

Offline retention tests:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
.\.venv\Scripts\python.exe -m pytest tests/test_retention.py -v --basetemp "$pytestTemp" -p no:cacheprovider
```

Full regression:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
.\.venv\Scripts\python.exe -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider
```

Set RUN_MYSQL_TESTS=1 around the full command, using the same try/finally, to
include all previous actual MySQL/auth/API/search integration tests. Without
the flag, integration tests skip explicitly. When opted in, unavailable MySQL
causes failures rather than fake passes. Standard tests never make paid calls.
Fresh Windows basetemp and disabled cache avoid the existing cache permissions
problem. See [actual results and every changed file](TASK13_VERIFICATION.md).

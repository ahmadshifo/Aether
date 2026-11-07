# Task 13 implementation and verification — 2026-11-07

Implemented on branch `feature/multimedia`. No commit, push, merge, server
upgrade, schema reset or paid provider request was performed for this task.
The existing private `api/.env` was preserved and `git check-ignore` confirms
it is ignored. Task 14 is not implemented.

## Files created or modified by Task 13

All paths below are relative to `multimedia/`.

| File | Responsibility |
| --- | --- |
| `processing/pipeline.py` (extended existing stub) | Injected video/frame orchestration, safe outcomes/counters, strict result validation, CLI modes and bounded analysis |
| `processing/pipeline_demo.py` (new) | Explicit deterministic mocked Task 7-9 results and real synthetic MJPG video generator |
| `database/repository.py` (extended) | Bounded expired-ID keyset query, MySQL advisory coordination, expiry recheck under existing safe-delete row lock and structured deletion outcome; ordinary delete_frame still returns bool |
| `database/retention.py` (new) | Dry-run default, explicit deletion, scoped testing, bounded reports, periodic foreground worker and CLI |
| `scripts/demo_retention.py` (new) | Create/verify/remove only unique marked synthetic retention fixtures |
| `tests/test_pipeline.py` (new) | Offline actual OpenCV orchestration and injected stage/failure contract tests |
| `tests/test_retention.py` (new) | Offline cleanup, temporary files, path safety, batching, recovery, lock and worker tests |
| `tests/test_pipeline_integration.py` (new) | Opt-in actual MySQL/JPEG/OpenCV/search/HTTP and retention tests, mocked AI only |
| `api/.env.example` (appended) | Four optional pipeline/retention defaults, preserving existing settings |
| `README.md` (updated) | Task 13 guide/report links |
| `database/README.md` (updated) | Clarifies cleanup is added by Task 13 and links the guide |
| `processing/PIPELINE.md` (new) | Architecture, reuse, error/time/privacy policies and exact manual PowerShell A-H commands |
| `processing/TASK13_VERIFICATION.md` (new) | This report and Git snapshot |

There were already extensive uncommitted Task 10-12/auth changes when Task 13
started, including files under web and an untracked user node_modules directory.
They were left in place. Task 13 did not modify mobile, web, shared/contracts,
the root deployment files, API routes/schemas/security, provider implementations,
database models/schema, requirements, or the private environment files.

## Implementation and component reuse

The sequence is existing VideoReader through FrameExtractor, FrameSelector
(quality and duplicate rules once), Mistral OCR, combined OpenAI Vision plus
caption access, Task 9 description/embedding, Task 10 validation and private
JPEG/MySQL repository persistence. Rejected frames trigger no downstream calls
or persistence. No provider or sampling implementation is duplicated.

OCR text retains Unicode/line breaks. Object labels and captions are the actual
injected/provider outputs. Vision uncertainty is retained in the processing
outcome; no new database column is invented. Embeddings retain the shared model
and 1536 finite numeric dimensions. Empty metadata yields SQL NULL, never a
fabricated zero vector. Offline fixtures explicitly label analysis as MOCK and
the report as mocked; their vectors are synthetic, not real model outputs.

`process_frame()` separates reusable decoded-frame processing from video
acquisition. Selector state is reset between videos; repeated runs create new
UUIDs, with no promise of cross-run idempotency. Only accepted and successfully
analyzed frames reach the existing repository. Source index, video offset,
absolute UTC capture time and database insertion time remain distinct.
Missing recording start uses a labelled run-start substitution. Expiration
remains insertion-based 24-hour retention, even for old prerecorded videos.

Ordinary analysis/storage failures affect one frame and are reported without
private exception text or fabricated partial metadata. Authentication,
configuration, quota, DB connectivity and uncertain storage outcomes stop the
run. Reader and generator resources close on limits/errors. Existing repository
rollback and quarantined-file recovery are preserved.

Retention defaults to preview. Execution uses bounded keyset pages, fixed UTC
eligibility, a database-scoped MySQL advisory lock and a per-row locking expiry
recheck. Expired rows with missing files are explicitly counted and removed.
Precommit failure restores JPEG/rolls back; uncertain commit or unlink failure
retains recovery evidence, stops the cycle and does not claim clean deletion.
No recursive deletion or path-based guesswork is used. The foreground worker
has interruptible waits and no import/FastAPI startup side effects. Automatic
physical removal requires that worker or an external scheduler to remain active.
Search/image expiry exclusions do not depend on physical cleanup.

## Executed test results

| Suite | Passed | Failed | Errors | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Offline pipeline | 52 | 0 | 0 | 0 |
| Offline retention | 48 | 0 | 0 | 1 |
| New actual MySQL pipeline/retention integration | 16 | 0 | 0 | 0 |
| Full default multimedia regression | 778 | 0 | 0 | 73 |
| Full regression with RUN_MYSQL_TESTS=1 | **850** | **0** | **0** | **1** |

All 734 previous Task 1-12/auth tests passed with MySQL enabled, plus 116 new
passing Task 13 cases. The one skipped test requires Windows privileges to
create an actual symlink. A separate nonprivileged resolved-redirection test
passed, as did traversal and UUID/path mismatch rejection. Default-suite skips
are 72 explicitly opt-in MySQL integration cases plus that symlink case.

One existing upstream Starlette TestClient/httpx deprecation warning remains;
it is not a test failure. No dependency was changed to hide it.
`pip check`: no broken requirements. `git diff --check`: passed (Git emitted
ordinary existing LF/CRLF conversion notices).

Actual database testing used the configured **native MySQL 8.0.43** server,
SQLAlchemy and PyMySQL, not SQLite or a simulated database. MySQL 8.4 was not
separately run in this environment. The previously accepted 8.0/8.4 compatibility
guard was not changed. Existing schema was checked, not reset.

Actual integration coverage includes:

- Real OpenCV extraction/selection and actual reader/frame counters.
- Metadata mapping, Arabic OCR, object labels, captions, JSON array dimensions,
  timestamp offsets, insertion-based expiration and saved UUIDs.
- Real exclusive JPEG persistence/retrieval/decoding and independent-connection
  persistence, session separation and cleanup of only generated UUIDs.
- Expired/active rows, dry-run preservation, execution, equal-expiry keyset pages,
  missing JPEG recovery and repeatability.
- A separate database pool's contention for the real advisory lock; concurrent
  expiry edits rechecked under the real deletion row lock.
- Test-controlled MySQL flush failure restoring the quarantined JPEG and row.
- Task 11 history excluding expired rows before physical cleanup.
- Existing authenticated Task 12 timeline/image/history search behavior and
  required-limit validation over actual MySQL data, with mocked query embeddings.

Full-run logs generated in the Windows temporary directory:

- Default: `aether-pytest-501aa005b7ba43b6ae6925c36b783cf8.log` — 778 passed,
  73 skipped, 88.50 seconds.
- MySQL enabled: `aether-pytest-e5596ded83f54f68b6275e9877106ed8.log` — 850 passed,
  1 skipped, 124.07 seconds.

## Executed CLI verification

The offline CLI read a newly generated real four-second MJPG video using the
actual extractor/selector. Output: decoded 40, sampled 4, selected 2, rejected 2,
analyzed 2, saved 0, failed 0. Decisions: first_frame, duplicate, blurry,
new_scene. No Database or paid provider was required. Its temporary source
video was removed afterward.

The actual retention CLI was run against newly seeded synthetic records scoped
to a unique test session, never globally executed against unrelated data:

1. Preview found one expired row and deleted nothing.
2. Explicit execute deleted one expired row and its JPEG, with zero failures.
3. A fresh helper invocation confirmed expired row/JPEG absent and active
   row/JPEG retained.
4. Explicit fixture cleanup removed only the remaining synthetic row/JPEG.

The periodic worker's reporting, stop-event behavior, Ctrl+C handling and
coordination failure exit were tested offline. A permanent worker was not left
running, and no claim is made that cleanup continues after the process stops.

Live Mistral/OpenAI requests were **not executed**. The pipeline's integration
uses the actual existing service interfaces, with deterministic mocked outputs
in tests. Live keys, quota, billing and provider availability remain to be
verified using the small explicit `--live --execute --max-frames 2` procedure
in [the guide](PIPELINE.md). A live dry-run still incurs AI charges.

## Team contracts and Git

The four HTTP endpoints, authentication/ownership checks and shared JSON
contracts are unchanged. POST search still requires session_id, query, mode and
limit. Responses preserve both equal UTC timestamp and captured_at, relative
authorized image URLs and existing relevance scores. No raw vectors/paths are
added. No mobile/web/streaming or MediaMTX work was performed.

Current branch is feature/multimedia. All Task 13 changes remain uncommitted.
The working tree also contains earlier authorized changes; the snapshot below
lists them without attributing them to Task 13. No files were staged or pushed.

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
?? multimedia/processing/PIPELINE.md
?? multimedia/processing/TASK13_VERIFICATION.md
?? multimedia/processing/pipeline_demo.py
?? multimedia/scripts/demo_api_data.py
?? multimedia/scripts/demo_retention.py
?? multimedia/scripts/demo_search.py
?? multimedia/tests/test_api.py
?? multimedia/tests/test_api_integration.py
?? multimedia/tests/test_auth_database_integration.py
?? multimedia/tests/test_pipeline.py
?? multimedia/tests/test_pipeline_integration.py
?? multimedia/tests/test_retention.py
?? multimedia/tests/test_search_integration.py
?? multimedia/tests/test_search_service.py
?? web/dashboard/node_modules/
```

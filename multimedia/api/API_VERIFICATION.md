# Task 12: implementation and verification report

Verification date: 2026-11-06. Branch: feature/multimedia.
Status: implemented; offline, real MySQL and native Uvicorn HTTP checks passed.
No commit or push was performed. Tasks 13/14 were not implemented.

## Files created or modified for Task 12

Paths are relative to multimedia/:

| File | Responsibility |
| --- | --- |
| api/main.py | Canonical factory/app, lifecycle, safe middleware, CORS and optional settings-based runner |
| api/routes.py | Four thin synchronous HTTP handlers and stable session-bound cursor mapping |
| api/schemas.py | Pydantic v2 request/public response models, strict UTC aliases, numerical bounds and safe errors |
| api/dependencies.py | Overridable HTTP/database/repository/search/embedding/clock/settings dependencies |
| api/security.py | Existing JWT/refresh cookies, account existence and session ownership; no new login endpoints |
| api/settings.py | HTTP/CORS settings and read-only reuse of the existing private signing secret |
| api/errors.py | Central status mapping and redacted error responses/logging |
| api/app/main.py | Compatibility import of the exact same canonical app object |
| api/app/routes.py | Compatibility import of the same router |
| api/app/schemas.py | Compatibility exports of the same public models |
| database/repository.py | Read-only account/session/refresh lookups; bounded timeline reuse of Task 11 keyset iteration |
| api/requirements.txt | Declare already installed Pydantic v2 and PyJWT dependencies |
| api/.env.example | API_HOST, API_PORT, explicit frontend origins and existing-secret guidance |
| api/Dockerfile | Python 3.13 and correct source/build context; root deployment unchanged |
| .dockerignore | Exclude credentials, virtual environments, stored images and test artifacts from image context |
| scripts/demo_api_data.py | Explicit synthetic JPEG fixture and guarded, targeted deletion |
| tests/test_api.py | Offline HTTP/security/mapping/lifecycle behavior |
| tests/test_api_integration.py | Real MySQL HTTP with existing account cookies and fake query embeddings |
| api/README.md | Full launch, endpoint, cookie, CORS, cursor and PowerShell A-I guide |
| api/API_VERIFICATION.md | This measured verification report and Git snapshot |
| api/SEARCH.md | Link the existing search service to its new HTTP adapter |
| database/README.md | Current authorized-image endpoint documentation |
| README.md | Task 12 overview and correct virtual-environment launch command |

There is one production FastAPI application, not two implementations. Legacy
api.app.main:app is the same Python object as api.main:app. No Task 9 provider,
Task 11 ranking algorithm, database model or connection manager was replaced.

## Actual automated results

| Executed check | Passed | Failed | Errors | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Final Task 12 offline HTTP cases | 79 | 0 | 0 | 0 |
| Final Task 12 real MySQL API cases | 18 | 0 | 0 | 0 |
| Full default multimedia tests/ | 678 | 0 | 0 | 56 |
| Full tests/ with RUN_MYSQL_TESTS=1 | 734 | 0 | 0 | 0 |

Per-file counts were measured from the final executed runs, not claimed from
unexecuted mocks. The 97 Task 12 cases also passed together. All 637 existing
Task 1-11/authentication tests passed in the final real-MySQL regression.
The default run's 56 skips are opt-in real database cases: 15 storage,
8 authentication, 15 search and 18 HTTP API integration cases.

One existing upstream Starlette TestClient/httpx deprecation warning remains;
there were no test failures. Dependencies were not upgraded. pip check and
git diff --check passed. Git only reported normal LF/CRLF conversion notices.
Every pytest run used a fresh Windows TEMP basetemp and -p no:cacheprovider.
Exact reusable commands use .\.venv\Scripts\python.exe and are in README.md.

The actual server was MySQL Community 8.0.43, database multimedia_project.
The user's earlier authorization to support this installed version remains
in effect; Task 12 did not replace it with the template's 8.4 instance. Existing
8.4 support is retained, but no actual 8.4 server test is claimed.

Environment: Windows, Python 3.13.7, FastAPI 0.162.0, Pydantic 2.14.2,
Starlette 1.10.0, Uvicorn 0.54.0 and PyJWT 2.15.1 in multimedia/.venv.

## Real native Uvicorn HTTP verification

A temporary Uvicorn subprocess was started using api.main:app on an available
127.0.0.1 port. This was a real TCP HTTP check in addition to TestClient tests:

- /health returned 200 with only the agreed service/status/version fields.
- /docs returned Swagger HTML; /openapi.json listed the four agreed paths.
- Existing account-backend signup cookies authenticated the multimedia API.
- Timeline returned a frame inserted through the real MySQL repository.
- Image retrieval returned exactly the saved JPEG bytes and OpenCV decoded
  them to the expected synthetic image shape.
- Latest search returned that actual row with a recency score of zero.
- Configured CORS preflight worked; an anonymous image request returned 401.

The child process had an empty OpenAI key and used latest mode, so it could not
make a paid embedding request. Only its generated synthetic email/account,
session, frame and JPEG were removed. Only the temporary subprocess was stopped;
the user's existing backend and MySQL services were not stopped or upgraded.

A second temporary Uvicorn process used a validly formatted but unreachable
process-only MySQL URL. It started successfully, /health remained 200, and an
authenticated protected data request returned a safe 503 database_unavailable.
No private URL/credential appeared in the response. This probe modified no rows
and was stopped afterward. Thus process liveness was verified separately from
actual database readiness instead of assuming one implies the other.

No paid OpenAI, Mistral, OCR or Vision requests were made. Semantic HTTP tests
used deterministic mocked query embeddings while retaining real MySQL rows,
actual Task 11 ranking and real repository calls. The unavailable-database test
inside the integration suite deliberately overrides a dependency; the native
outage probe separately exercised an actual failed connection.

## Endpoint architecture and compatibility

GET /health is public process liveness only. The three data paths reuse the
existing account login cookies and authorize the session:

- POST /api/v1/search accepts session_id, query, mode and limit, then delegates
  to SearchService without reimplementing ranking. Empty successful searches
  return HTTP 200 with frames=[].
- GET /api/v1/frames uses the existing repository, SQL expiry/capture filters,
  stable descending capture/UUID keysets, default limit 20/max 100, and nullable
  next_cursor. It reads no JPEG bytes or AI embeddings from a provider.
- GET /api/v1/frames/{frame_id}/image checks row existence, expiry and ownership,
  uses the approved repository loader, then rechecks expiry before returning
  actual image/jpeg bytes with private, no-store and nosniff headers.

All search fields remain required on HTTP input because the shared YAML marks
limit required; 5 is the normal supplied value and remains Task 11's Python
service default. HTTP limits are strict integers 1-20; a configured lower search
maximum also returns 422 rather than an internal error. Unicode text must have
meaningful content. Invalid input does not become a fake successful result.

Responses preserve frame_id, session_id, timestamp, image_url, caption, ocr_text,
objects and relevance_score. captured_at is also retained with the identical UTC
value, following the earlier user confirmation and the canonical shared schema.
No mandatory authentication body/query fields or renamed paths were introduced.
Member 2 uses the base URL plus the relative image_url and forwards the existing
account cookies; it does not need database/image-path/vector details.

Public schemas reject private extra fields, nonfinite/out-of-bounds scores,
naive or numeric/video-relative capture times and inconsistent aliases. Wrong
service mappings become safe 500 errors, not hidden truncation or invented
capture timestamps. Metadata is preserved rather than newly analyzed.

## Security, errors and lifecycle

The existing echosight_access HS256 JWT contract and hashed echosight_session
refresh records are reused. Accounts must exist and own the sessions row.
Knowing a UUID never grants image access. Another account's or unowned resource
is hidden behind 404; owned empty sessions produce empty 200 responses.

Multimedia does not issue/renew login tokens or add a parallel account service.
Refresh validation is read-only and respects expiry and maximum age. As in the
existing backend, a valid access JWT can outlive logout until its short expiry;
normal logout removes browser cookies. The existing account service remains
responsible for token renewal. Hostnames must match cookie scope.

The JWT secret is read from process settings, api/.env or the existing private
web/ai-backend/.env. Private files were not changed by Task 12 and remain ignored
by Git. Public templates contain no real secrets. Missing authentication
configuration fails closed instead of enabling public camera access.

API errors are consistent JSON with code, message and safe field names:
401 for missing/invalid login, 404 for unavailable/inaccessible frames,
422 for invalid requests/cursors, 502 for query embedding failure,
503 for unavailable database/configuration, 500 for unexpected/mapping failure.
Logs record error classes, never stringify provider or SQL exception bodies.
No image path, embedding, API key, database password or stack trace is returned.
There is no public static mount of the private JPEG directory.

CORS uses explicitly configured local frontend origins with credentials;
wildcards, credential-bearing URLs and malformed origins are rejected.
Preflight and unapproved-origin behavior passed tests. CORS is not identity or
session authorization. Local HTTP remains a development setup; public deployment
still requires the team's HTTPS/cookie/secret/origin configuration.

Existing Database construction is lazy and cached once per application behind
a lock. Repository sessions close normally, synchronous ORM/SDK work uses
FastAPI's thread pool, and the engine is disposed at lifespan shutdown.
Importing/creating the app does not connect or call AI services. No schema is
created automatically at server startup. A database readiness check remains
available through the existing CLI.

## Manual commands, boundaries and Git

[README.md](README.md) contains copy-ready PowerShell A-I scenarios: start,
health, Swagger, private login-cookie reuse, an owned synthetic session and
JPEG, search, timeline/pagination, image download, invalid requests, a temporary
unreachable-database probe, CORS, targeted cleanup and Ctrl+C shutdown. A dedicated
test account is specified because the existing streams/start route ends older
live sessions for the same account. No Task 13/14 processing is introduced.

Docker packaging was corrected to include the required modules and exclude
secrets/images/virtual environments. Docker was unavailable, so an image build
or container run is explicitly unverified. The repository-root deployment
configuration, mobile/, web/ and shared/contracts/ were not modified by Task 12.
Browser UI rendering, live camera streaming and real AI semantic quality are
not claimed from HTTP/database mechanics tests.

Current branch: feature/multimedia. No staging, commit or push was performed.
The snapshot below includes pre-existing Task 10/11/authentication edits and an
already-untracked web/dashboard/node_modules directory; these are not new
Task 12 edits outside the allowed scope.

```text
## feature/multimedia...origin/feature/multimedia
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
?? multimedia/scripts/demo_api_data.py
?? multimedia/scripts/demo_search.py
?? multimedia/tests/test_api.py
?? multimedia/tests/test_api_integration.py
?? multimedia/tests/test_auth_database_integration.py
?? multimedia/tests/test_search_integration.py
?? multimedia/tests/test_search_service.py
?? web/dashboard/node_modules/
```

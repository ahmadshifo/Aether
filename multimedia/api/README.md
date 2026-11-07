# Task 12: Aether Multimedia REST API

One FastAPI application exposes the existing Task 10 MySQL repository and
Task 11 search service. Canonical entry point: `api.main:app`. Legacy
`api.app.main:app` imports the same object, not a competing application.
Title: Aether Multimedia API. Version: 1.0.0. Tasks 13/14 are not implemented.

## Launch on Windows

From the repository root, change to multimedia/ and use its installed Python
directly. This avoids the system Python's "No module named pytest" problem.

```powershell
cd C:\Users\Technoline\Desktop\multimedia-project\multimedia

.\.venv\Scripts\python.exe -c "from api.main import app; print(app.title)"

.\.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
```

Expected import output: `Aether Multimedia API`. Import/startup do not connect
to MySQL, initialize tables or call AI providers. Open:

- http://127.0.0.1:8000/health
- http://127.0.0.1:8000/docs
- http://127.0.0.1:8000/openapi.json

The API has no homepage at `/`; a 404 there is normal. Stop Uvicorn with Ctrl+C.
Swagger and health remain available if the database is offline. Database
readiness is checked separately with the existing CLI:

```powershell
.\.venv\Scripts\python.exe -m database.connection --check
```

The working local setup remains MySQL Community 8.0.43 / multimedia_project,
as previously authorized. Existing support for 8.4 LTS is preserved; no server
upgrade, new database or schema migration was needed for Task 12.

## Endpoints and wire contract

| Method/path | Input | Successful response |
| --- | --- | --- |
| GET /health | None | status=ok, service=aether-multimedia, version=1.0.0 |
| POST /api/v1/search | session_id, query, mode, limit | frames array, including an empty array |
| GET /api/v1/frames | session_id; optional limit=20 and cursor | frames array plus nullable next_cursor |
| GET /api/v1/frames/{frame_id}/image | Frame UUID | Actual stored JPEG bytes; image/jpeg |

All three data endpoints reuse the existing account login cookies and require
the account to own the session. Authentication adds no body/query fields.

The shared YAML marks all four search fields required, so HTTP requests must
include limit. Use 5 as the normal value; accepted search limits are integers
1-20. A configured lower SEARCH_MAX_LIMIT is also enforced with HTTP 422.
This does not change Task 11's reusable Python default of 5. Modes are
latest/recent/history with unchanged Task 11 windows, ranking and fallbacks.
Timeline limits follow the shared contract: integers 1-100, default 20.

Frame objects preserve frame_id, session_id, image_url, caption, ocr_text and
objects. They include both timestamp and captured_at with identical ISO UTC
values ending in Z, following the user's earlier confirmation and retaining
the shared YAML's required captured_at field. Search additionally includes
finite relevance_score in [0,1]. It is a ranking score, not a probability.

The image URL is relative, `/api/v1/frames/{frame_id}/image`. Member 2 combines
it with the configured multimedia base URL, for example:

```javascript
new URL(frame.image_url, MULTIMEDIA_API_URL).href
```

Base URL/port are deployment settings, not contract changes. The existing web
template references port 8003; Member 2 can keep that by running this API with
`--port 8003`, or configure its multimedia base URL to port 8000. No teammate
client or root deployment file was modified by this task.

## Existing authentication and private image access

The existing account service on port 8002 remains the only signup/login/token
issuer. Multimedia validates the existing `echosight_access` HS256 JWT cookie
with typ=access, exp and UUID sub. It checks that the account still exists and
that the sessions row belongs to it. No shared-secret shortcut or anonymous
image mode was introduced. Knowing a frame/session UUID is not authorization.

If the JWT is missing/expired, a valid `echosight_session` cookie can be checked
against the existing hashed login_sessions token, expiry and maximum age.
This is read-only: multimedia does not issue cookies, extend login sessions,
duplicate signup/login or replace the account service. Refresh/renew login
through the existing account backend. As in that backend's existing design,
a valid access JWT can remain usable until its 15-minute expiry after logout;
normal browser logout deletes the cookies.

The same JWT_SECRET is used. It can come from the process environment, then
multimedia/api/.env, then the existing private web/ai-backend/.env. The latter
is read-only; it is not copied or modified. A missing signing secret never
permits an unverified JWT. Private settings and keys are not returned or logged.

Private frames made by standalone storage demos have no owning sessions row.
They are intentionally inaccessible through HTTP until associated with an
owned session through the existing team session flow. A valid unknown,
unowned, or other-account session/frame receives 404. An owned empty session
receives 200 with empty frames. Missing/invalid login cookies receive 401.

For browser cookies, use the same hostname used to sign in: localhost cookies
do not become 127.0.0.1 cookies. Swagger on the matching hostname can reuse
the browser's existing login. Cookie headers cannot be manually set through
browser JavaScript. Cross-origin frontend fetches require credentials=include.
Member 2's server-side client must forward the requesting account's existing
Cookie header for data requests; it does not need table or embedding details.

Images are loaded only through FrameRepository.load_frame_image(). Existing
UUID path validation, storage-root and symlink protections are reused. No
static storage mount or arbitrary filesystem-path parameter exists. Missing,
expired, inaccessible or physically missing JPEGs receive safe 404 responses.
Expiry is checked before reading and again before returning the bytes.
Responses use Cache-Control: private, no-store and nosniff. There are no OCR,
Vision or embedding calls on image/timeline requests.

Local HTTP is for development. Authentication/CORS are not a complete public
deployment setup: retain local bindings until the team configures HTTPS,
secure cookie handling, trusted deployment origins and secret distribution.

## Architecture, validation and lifecycle

- api/main.py creates the application, lifespan cleanup, middleware and handlers.
- api/routes.py validates/maps public HTTP input and delegates search unchanged.
- api/schemas.py contains strict public Pydantic v2 models; unexpected private
  fields, invalid scores or inconsistent time aliases cause a server error,
  not silent response filtering.
- api/dependencies.py provides overridable repository/search/embedding/clock
  dependencies and lazily creates one existing Database per application.
- api/security.py reuses the team's cookies and account/session ownership.
- api/settings.py reads only HTTP/auth configuration; Task 10/9 loaders remain
  responsible for database and provider settings.
- api/errors.py centralizes safe errors and redacted class-only logging.
- api/app/{main,routes,schemas}.py are compatibility imports of the same code.
- database/repository.py adds read-only account/session lookups and a bounded,
  unexpired timeline built on Task 11 keyset iteration. Existing methods remain.
- scripts/demo_api_data.py creates/deletes only explicitly synthetic demo data.
- tests/test_api.py and test_api_integration.py cover offline and real MySQL HTTP.
- api/requirements.txt declares Pydantic v2 and the already installed PyJWT;
  no dependency upgrade was performed.
- api/Dockerfile and multimedia/.dockerignore package the required source tree
  while excluding credentials, images, virtual environments and test artifacts.

Synchronous routes/dependencies run blocking ORM/SDK work in FastAPI's thread
pool. Database sessions are scoped by existing repository methods. The pooled
engine is reused and disposed on application shutdown. Health/OpenAPI require
no engine construction. No request-specific mutable state is global.

| Situation | Status |
| --- | --- |
| Successful operation, including empty search/timeline | 200 |
| Missing/invalid login | 401 |
| Missing/expired/unowned resource or missing JPEG | 404 |
| Invalid body, UUID, mode, limit or cursor | 422 |
| Query embedding failure | 502 |
| Database or necessary configuration unavailable | 503 |
| Unexpected failure or bad service response mapping | 500 |

Errors have `{ "error": { "code": "...", "message": "...", "fields": [] } }`.
Validation names only known public fields; it does not echo request values,
SQL, paths, provider bodies or stack traces. CORS preflight protocol errors are
handled by the standard CORSMiddleware. Input validation does not bypass login.

Timeline pagination uses an opaque URL-safe versioned cursor bound to the
session. It contains the last capture timestamp and UUID, not a row offset.
Deleting the previous page's last frame does not invalidate continuation.
Pagination is not an atomic snapshot over concurrent inserts/deletes.

## HTTP configuration and CORS

Existing database/AI/storage/retention settings are preserved. Optional values
in the established api/.env are:

```dotenv
API_HOST=127.0.0.1
API_PORT=8000
API_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174
```

`python -m api.main` honors API_HOST/API_PORT. The documented uvicorn command
uses its explicit --host/--port arguments instead. Legacy MULTIMEDIA_API_*
settings are retained. Process settings override dotenv values; malformed
configuration fails clearly without printing its value. Allowed origins are
explicit; wildcard origins/credentialed wildcard access are rejected.
GET/POST and Content-Type/Accept preflights are supported with credentials.
CORS does not authorize sessions or replace login.

## Manual verification A-I

Keep the existing account backend running on port 8002. If necessary, start
it in a separate terminal from multimedia/ with:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir ../web/ai-backend --host 127.0.0.1 --port 8002
```

Do not start a duplicate backend if port 8002 is already in use by that service.
The application email/password below are your normal signup credentials, not
the MySQL root login.

**A-C: start multimedia, health and docs.** Use the launch command above in one
terminal. In another PowerShell terminal, also positioned at multimedia/:

```powershell
$base = "http://127.0.0.1:8000"
Invoke-RestMethod "$base/health"
Start-Process "$base/docs"
Invoke-RestMethod "$base/openapi.json" | Select-Object -ExpandProperty paths
```

**Prepare an owned session and actual synthetic JPEG for D-F.** Use a dedicated
application test account, created through the existing frontend. The existing
streams/start flow closes earlier live sessions for the same account; using a
test account keeps your real phone stream unaffected. Prompt for those test
account credentials privately; no password appears in commands:

```powershell
$credential = Get-Credential -Message "Dedicated test account email and password"
$loginBody = @{
    email = $credential.UserName
    password = $credential.GetNetworkCredential().Password
} | ConvertTo-Json

$account = Invoke-RestMethod -Uri "http://127.0.0.1:8002/api/v1/auth/login" -Method Post -ContentType "application/json" -Body $loginBody -SessionVariable auth

$sessionId = [guid]::NewGuid().ToString()
$sessionBody = @{ session_id = $sessionId } | ConvertTo-Json
Invoke-RestMethod -Uri "http://127.0.0.1:8002/api/v1/streams/start" -Method Post -ContentType "application/json" -Body $sessionBody -WebSession $auth

$demo = .\.venv\Scripts\python.exe -m scripts.demo_api_data --session-id "$sessionId" | ConvertFrom-Json
```

This registers a synthetic session; it does not publish camera video. The demo
JPEG has OCR metadata ROOM 205, door/sign labels and a marked synthetic caption.
Its embedding is NULL: no paid analysis is requested or invented. Its frame ID
comes from the repository, not a hard-coded placeholder.

**D: search.** This is the agreed request format. An owned session without
matching evidence returns empty frames. With NULL demo embeddings, the generic
classroom question may return empty; that is not an error:

```powershell
$body = @{
    session_id = $sessionId
    query = "What was written on the classroom door?"
    mode = "recent"
    limit = 5
} | ConvertTo-Json
Invoke-RestMethod -Uri "$base/api/v1/search" -Method Post -ContentType "application/json" -Body $body -WebSession $auth
```

For a meaningful demo without paid requests, use its exact OCR fallback. Leave
SEARCH_MIN_SIMILARITY blank for this literal-fallback demonstration. It
returns the actual demo frame with relevance_score 0, not fabricated semantic
confidence. Use history so the demo still works after two minutes:

```powershell
$body = @{ session_id = $sessionId; query = "What says ROOM 205?"; mode = "history"; limit = 5 } | ConvertTo-Json
Invoke-RestMethod -Uri "$base/api/v1/search" -Method Post -ContentType "application/json" -Body $body -WebSession $auth
```

latest can also return the demo within ten seconds of creation, with score 0
and no query embedding. Semantic searches over real non-NULL embeddings may
make one paid query embedding request; tests use mocked queries instead.

**E: timeline and pagination.**

```powershell
$page = Invoke-RestMethod -Uri "$base/api/v1/frames?session_id=$sessionId&limit=20" -WebSession $auth
$page | ConvertTo-Json -Depth 6
if ($page.next_cursor) {
    $cursor = [uri]::EscapeDataString($page.next_cursor)
    Invoke-RestMethod -Uri "$base/api/v1/frames?session_id=$sessionId&limit=20&cursor=$cursor" -WebSession $auth
}
```

**F: retrieve and verify a real JPEG.** Save the generated image under an ignored
temporary folder and verify its JPEG start marker. Full decode and byte equality
are verified in automated integration tests.

```powershell
$frameId = $page.frames[0].frame_id
New-Item -ItemType Directory -Path temp -Force | Out-Null
$jpegPath = Join-Path (Get-Location) "temp/retrieved_frame.jpg"
Invoke-WebRequest -UseBasicParsing -Uri "$base/api/v1/frames/$frameId/image" -WebSession $auth -OutFile "$jpegPath"
$bytes = [IO.File]::ReadAllBytes($jpegPath)
($bytes.Length -gt 2) -and ($bytes[0] -eq 255) -and ($bytes[1] -eq 216)
```

Expected True. A random placeholder frame UUID does not retrieve an image.

**G: invalid requests and unavailable database.**

```powershell
function Get-ApiStatus($uri, $method = "Get", $json = $null) {
    try {
        $options = @{ Uri=$uri; Method=$method; WebSession=$auth; UseBasicParsing=$true; ErrorAction="Stop" }
        if ($null -ne $json) { $options.ContentType="application/json"; $options.Body=$json }
        [int](Invoke-WebRequest @options).StatusCode
    } catch {
        if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { throw }
    }
}

# All 422:
Get-ApiStatus "$base/api/v1/frames?session_id=invalid"
Get-ApiStatus "$base/api/v1/frames?session_id=$sessionId&limit=0"
Get-ApiStatus "$base/api/v1/search" "Post" (@{session_id=$sessionId;query="";mode="recent";limit=5} | ConvertTo-Json)
Get-ApiStatus "$base/api/v1/search" "Post" (@{session_id=$sessionId;query="door";mode="wrong";limit=5} | ConvertTo-Json)

# 404 for an unknown frame; 401 if login cookies are omitted:
Get-ApiStatus "$base/api/v1/frames/$([guid]::NewGuid())/image"
```

To verify a database outage without changing private files or stopping MySQL,
launch a second temporary API process with an unreachable process-only URL:

```powershell
$apiSavedDbUrl = $env:DATABASE_URL
$apiProbeServer = $null
try {
    $env:DATABASE_URL = "mysql+pymysql://unavailable:unavailable@127.0.0.1:1/unavailable?charset=utf8mb4"
    $apiProbeServer = Start-Process -FilePath (Resolve-Path .\.venv\Scripts\python.exe).Path -ArgumentList @("-m","uvicorn","api.main:app","--host","127.0.0.1","--port","8015") -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -PassThru
} finally {
    if ($null -eq $apiSavedDbUrl) { Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue } else { $env:DATABASE_URL = $apiSavedDbUrl }
}
try {
    Start-Sleep -Seconds 5
    $apiProbeServer.Refresh()
    if ($apiProbeServer.HasExited) { throw "Probe server did not start; check whether port 8015 is available." }
    Invoke-RestMethod "http://127.0.0.1:8015/health" # 200, process is alive.
    Get-ApiStatus "http://127.0.0.1:8015/api/v1/frames?session_id=$sessionId" # 503.
} finally {
    if ($null -ne $apiProbeServer) { Stop-Process -Id $apiProbeServer.Id -ErrorAction SilentlyContinue }
}
```

**H: configured and unapproved browser origins.**

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "$base/api/v1/search" -Method Options -Headers @{
    Origin="http://localhost:5174"
    "Access-Control-Request-Method"="POST"
    "Access-Control-Request-Headers"="Content-Type"
} | Select-Object StatusCode, Headers

try {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/api/v1/search" -Method Options -Headers @{
        Origin="https://unapproved.example"
        "Access-Control-Request-Method"="POST"
    }
} catch { [int]$_.Exception.Response.StatusCode } # 400; no permissive allow-origin.
```

**Cleanup and I: stop.** Delete only the generated synthetic frame; the helper
refuses ordinary frames or another session. End the synthetic stream metadata,
then Ctrl+C in the multimedia Uvicorn terminal:

```powershell
.\.venv\Scripts\python.exe -m scripts.demo_api_data --session-id "$sessionId" --delete --frame-id "$($demo.frame_id)"
Invoke-RestMethod -Uri "http://127.0.0.1:8002/api/v1/streams/stop" -Method Post -ContentType "application/json" -Body $sessionBody -WebSession $auth
```

## Automated tests

Task 12 offline HTTP tests:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
.\.venv\Scripts\python.exe -m pytest tests/test_api.py -v --basetemp "$pytestTemp" -p no:cacheprovider
```

Real Task 12 MySQL HTTP integration with synthetic data and mocked embeddings:

```powershell
$env:RUN_MYSQL_TESTS = "1"
try {
    $pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
    .\.venv\Scripts\python.exe -m pytest tests/test_api_integration.py -v --basetemp "$pytestTemp" -p no:cacheprovider
}
finally {
    Remove-Item Env:\RUN_MYSQL_TESTS -ErrorAction SilentlyContinue
}
```

Full default regression (real-MySQL suites skip explicitly):

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
.\.venv\Scripts\python.exe -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider
```

For a full real-MySQL regression, put that last pytest command inside the same
RUN_MYSQL_TESTS try/finally block. No offline test requires MySQL, OpenAI keys,
Mistral, streaming or image fixtures. Integration tests use generated emails,
account/session/frame UUIDs and only remove their own synthetic data. The
database-outage test intentionally overrides a dependency; other integration
cases actually use MySQL. No paid request is made during tests.

## Optional API-only Docker packaging

The API Dockerfile now uses Python 3.13 and includes api/, database/ and
processing/. Build context is multimedia/, not api/. Private .env files, stored
images and virtual environments are excluded. Supply DATABASE_URL, the existing
JWT_SECRET and a managed JPEG storage volume at runtime. The host database address
inside a container is not the container's own 127.0.0.1. Publish host ports on
loopback for development. The repository-root Compose file was not changed.
Docker was unavailable during this task; an image build/run is not claimed.

See API_VERIFICATION.md for exact executed results, actual native HTTP checks,
changed files, Git state and remaining verification boundaries. Framework
references: [FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/),
[exception handlers](https://fastapi.tiangolo.com/tutorial/handling-errors/),
and [CORS](https://fastapi.tiangolo.com/tutorial/cors/).

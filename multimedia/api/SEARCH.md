# Task 11: time and semantic frame search

`api.search_service.SearchService` is a reusable Python service with dependency
injection. It returns the agreed response object without creating HTTP routes.
Task 12 exposes search and authorized image retrieval through api.main:app;
see README.md in this directory for the HTTP layer. The search service adds no
processing pipeline, live stream integration, database model or embedding provider.
The existing MySQL 8.0.43 setup remains working; 8.4 support
from Task 10 is preserved. DATABASE_URL and private configuration are unchanged.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| api/search_service.py | Input/config validation, UTC windows, bounded ranking, mapping and CLI |
| api/__init__.py | Explicit package for `python -m api.search_service` |
| api/app/search_service.py | Compatibility import of the same service; no duplicate engine |
| api/search_demo.py | Clearly synthetic offline metadata and deterministic test vectors |
| database/repository.py | Read-only SearchCandidate projection and SQL keyset iteration |
| scripts/demo_search.py | Reproducible scenarios A-F, optional real MySQL and targeted cleanup |
| tests/test_search_service.py | Offline behavior and repository-boundary tests |
| tests/test_search_integration.py | Real MySQL tests with mocked query embeddings |
| api/.env.example | Documented SEARCH_* defaults; no secrets |
| api/SEARCH.md | Algorithm, configuration, commands and limitations |
| api/SEARCH_VERIFICATION.md | Actual results and Git snapshot |
| README.md and database/README.md | Search entry points and current startup instructions |

## Python usage and result mapping

Run Python from `multimedia/`:

```python
from database.connection import Database
from database.repository import FrameRepository
from processing.embedding_service import EmbeddingService
from api.search_service import SearchService

with Database() as database:
    repository = FrameRepository.from_database(database)
    search = SearchService(repository, EmbeddingService())
    response = search.search(
        session_id="550e8400-e29b-41d4-a716-446655440000",
        query="What was written on the classroom door?",
        mode="recent",
        limit=5,
    )
```

The result is `{"frames": [...]}`. Each item contains UUID strings, caption,
exact OCR text, copied object labels, relevance_score, and
`/api/v1/frames/{frame_id}/image`. It contains neither a private image path nor
an embedding, password, database URL or API key.

The Task 11 examples use `timestamp`; the canonical shared YAML requires
`captured_at`. At the user's request **both fields** contain the same ISO 8601
UTC value ending in Z. The YAML permits additional properties, so the output
retains its required fields and the example alias without changing the contract.
The search service returns an image reference only; Task 12 serves its bytes
with authentication, ownership and expiry checks.
Session filtering is not caller authentication: the Task 12 HTTP layer
authorizes the requested session and image access.

## Time modes and candidate retrieval

One timezone-aware clock reading anchors each request. Tests inject a fixed
clock. Caller timestamps must be aware; MySQL DATETIME(6) values are converted
by Task 10's UTCDateTime adapter. No absolute capture time is invented from a
video-relative offset, creation time or local Beirut time.

| Mode | Inclusive capture interval | Ranking | Query embedding requests |
| --- | --- | --- | --- |
| latest | now minus 10 seconds through now | Newer captured_at, then larger UUID | Zero |
| recent | now minus 120 seconds through now | Higher ranking score, newer capture, larger UUID | At most one |
| history | All retained captures at or before now | Same semantic ranking as recent | At most one |

Every mode requires expires_at strictly greater than the request clock time.
A frame exactly 10/120 seconds old is included; a frame expiring exactly now
is excluded. Future captures are excluded. History follows stored expires_at;
Task 10's 24-hour retention is insertion-based, so it does not invent a second
expiration rule based on capture age. Empty windows return `{"frames": []}`.

`FrameRepository.iter_search_candidates(session_id, start_time=None,
end_time=None, *, now=None, batch_size=128)`:

- Applies session, capture bounds and expiry in MySQL with bound parameters.
- Selects only identifiers, capture/expiry times, OCR, objects, caption and
  JSON embeddings/model. It does not select image paths, open JPEGs or hydrate
  complete ORM entities.
- Uses descending `(captured_at, frame_id)` keyset pagination. Each session is
  closed before yielding its bounded batch. Skipped vectors still advance the
  cursor, so malformed legacy vectors cannot stop pagination.
- Has no total-candidate limit. History examines every matching row, including
  the best match beyond the first several hundred records.

The service defensively rechecks session/time/expiry even with an injected
repository. Searching never inserts, updates or deletes records. Demonstration
scripts and integration fixtures explicitly write their own synthetic rows
and delete only their own generated frame UUIDs afterward.

## Embeddings, OCR evidence and scores

The service calls Task 9's `EmbeddingService.embed_query()` once, lazily when
the first usable semantic candidate is found. It reuses EmbeddingResult,
`text-embedding-3-small`, 1536 dimensions, Task 10's finite/nonzero vector
validation, and Task 9's existing `cosine_similarity()` implementation.
There is no second cosine algorithm, OCR/Vision request or new caption.

Non-NULL vectors with wrong model, dimensions, shape, NaN, infinity, booleans or
zero magnitude are excluded. They are never padded, truncated or replaced.
Invalid query embeddings and provider failures fail the search with a sanitized
SearchEmbeddingError; partial/fabricated matches are not returned.

For semantic modes, let `c` be raw cosine in [-1, 1], `b` the configured OCR
boost and `e` equal 1 when a complete OCR line occurs as whole tokens in the
query, otherwise 0. The ranking score is:

```text
score = ((c + 1) / 2 + b * e) / (1 + b)
```

It is finite, bounded to [0, 1], and **not a correctness probability**. Dividing
by the same 1+b keeps exact OCR evidence distinguishable even for otherwise
identical perfect vectors. Default b=0.1 is a small transparent heuristic; set
it to 0 to disable it. Matching is Unicode/case-insensitive and token-based,
so ROOM 205 does not match ROOM 206 or ROOM 2050. Original OCR text, punctuation,
captions and object labels are returned unchanged. There is no separate object
boost: Task 9 already includes objects and captions in the stored embedding.

Missing embeddings have explicit behavior:

- latest uses capture recency only and always returns score **0**, even if the
  row has an embedding. It claims no semantic comparison and needs no API key.
- recent/history exclude missing embeddings unless an exact whole OCR line
  matches the query and no semantic threshold was configured. Such literal
  fallback results score **0** and cause no embedding request on their own.
- When a minimum cosine threshold is configured, missing embeddings cannot
  satisfy it. Invalid non-NULL vectors never qualify as literal fallbacks.

The optional threshold is applied to **raw cosine before the OCR boost**, not
to the returned normalized score. Below-threshold results are excluded and an
empty result is permitted. It is ignored in latest mode because recency is
the retrieval reason. Default is no threshold; calibrate it with labeled real
examples instead of treating any number as universally correct. Unfiltered
ranking can return unrelated low-quality matches; scores are not confidence.

## Settings

Settings are read from the established api/.env with interpolation disabled;
process environment overrides the file. No extra environment file is created.

```dotenv
SEARCH_LATEST_SECONDS=10
SEARCH_RECENT_SECONDS=120
SEARCH_DEFAULT_LIMIT=5
SEARCH_MAX_LIMIT=20
SEARCH_BATCH_SIZE=128
SEARCH_MIN_SIMILARITY=
SEARCH_OCR_BOOST=0.1
```

Omitted Python limits use the configured default; explicit None, booleans,
nonintegers and out-of-range limits are rejected. Max results cannot exceed 20.
Batch size is 1-1000. SEARCH_MIN_SIMILARITY is blank or a finite value in [-1, 1].
The real embedding service continues using the existing OPENAI_EMBEDDING_MODEL
and OPENAI_EMBEDDING_DIMENSIONS settings. Do not change DATABASE_URL to test
the offline demo. Limits/windows/configuration are validated before I/O.

## Copy-ready PowerShell commands

From the repository root:

```powershell
cd C:\Users\Technoline\Desktop\multimedia-project\multimedia
.\.venv\Scripts\Activate.ps1
```

Offline scenarios A-F, no MySQL or API key:

```powershell
python -m scripts.demo_search
```

The same scenarios against the configured real MySQL database, using synthetic
query vectors and temporary synthetic rows/JPEGs, without external AI calls:

```powershell
python -m scripts.demo_search --mysql
```

Expected: classroom-door frame first; latest returns only the 3-second-old
frame; history includes a one-hour-old frame; unrelated synthetic query with
threshold 0.6 returns empty; sessions stay separate; invalid requests rejected.
The MySQL command generates its own session/frame UUIDs and cleans up afterward.
Its output prints actual scores/IDs. Synthetic axes demonstrate mechanics,
not the quality of a real language model. At defaults the perfect non-OCR
synthetic match scores about 0.909091 and an orthogonal match about 0.454545.

Individual offline CLI scenarios with fixed synthetic data:

```powershell
$session = "550e8400-e29b-41d4-a716-446655440000"

# A: ROOM 205 ranks first; laptop/EXIT are weaker synthetic matches.
python -m api.search_service --offline-demo --session-id "$session" --query "What was written on the classroom door?" --mode recent --limit 5

# B: only the frame captured 3 seconds ago; score 0 is a recency fallback.
python -m api.search_service --offline-demo --session-id "$session" --query "classroom door" --mode latest

# C: includes the older classroom frame; no 2-minute cutoff.
python -m api.search_service --offline-demo --session-id "$session" --query "classroom door" --mode history --limit 20

# D: empty frames, using a threshold chosen only for these synthetic axes.
python -m api.search_service --offline-demo --session-id "$session" --query "purple umbrella" --mode history --min-similarity 0.6 --json

# E: only the second session's frame, never the first session's frames.
python -m api.search_service --offline-demo --session-id "550e8400-e29b-41d4-a716-446655440001" --query "classroom door" --mode history

# F: meaningful validation errors; no database or embedding request.
python -m api.search_service --offline-demo --session-id invalid --query "door"
python -m api.search_service --offline-demo --session-id "$session" --query "door" --mode wrong
python -m api.search_service --offline-demo --session-id "$session" --query "door" --limit 0
```

Normal CLI uses real MySQL; recent/history may incur one OpenAI request when
there are usable candidates. Replace the session with an existing session:

```powershell
python -m api.search_service --session-id "YOUR_EXISTING_SESSION_UUID" --query "What was written on the classroom door?" --mode recent --limit 5 --json
```

Exit codes: 0 for a completed search (including empty frames), 1 for input,
configuration/database/provider failure, 2 for argparse syntax/choice errors.
No query is silently truncated or rewritten. Error text suppresses SQL,
provider bodies and credentials. Importing or constructing search starts no
database connection, API call or server.

Scenario G is deliberately optional and **was not executed**. After offline
and MySQL tests pass, this Task 9 command makes one real paid query embedding
request, independently of whether MySQL contains frames:

```powershell
python -m processing.embedding_service --query "What was written on the classroom door?"
```

It requires usable OpenAI configuration/credits. Real search quality also needs
stored frame embeddings from the same actual model; do not compare a real query
against the synthetic demo axes and call that semantic-quality verification.

## Automated verification

Offline Task 11 only:

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_search_service.py -v --basetemp "$pytestTemp" -p no:cacheprovider
```

Real Task 11 MySQL integration, with mocked query embeddings:

```powershell
$env:RUN_MYSQL_TESTS = "1"
try {
    $pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
    python -m pytest tests/test_search_integration.py -v --basetemp "$pytestTemp" -p no:cacheprovider
}
finally {
    Remove-Item Env:\RUN_MYSQL_TESTS -ErrorAction SilentlyContinue
}
```

Full default regression (MySQL suites skip explicitly):

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider
```

For a full real-database regression use that last pytest command inside the
RUN_MYSQL_TESTS try/finally block. The earlier authentication tests also require
the existing web/ai-backend dependencies installed in the test environment.
No search unit test needs MySQL, OpenAI, Mistral, a camera or image fixtures.

## Limits and verification boundaries

For N candidates, dimension d=1536 and requested limit L<=20, ranking costs
O(N*d + N*log L); memory is one bounded SQL batch plus the best L responses and
one query vector. There is no silently truncated candidate count. Very large
OCR fields still consume memory within a batch. This JSON/Python approach is
for a university demo, not an approximate vector index for millions of frames.

Each SQL page is a separate read transaction. Searches use a fixed request
clock, not a global snapshot across concurrent insertion/deletion; concurrent
backdated inserts can affect which rows are seen. The Task 12 HTTP layer checks access
and expiry when actually serving an image. No orphan or expiry deletion worker
is added here. The existing session/capture-time index is reused.

Implementation uses SQLAlchemy's existing
[selection of individual mapped attributes](https://docs.sqlalchemy.org/en/20/orm/queryguide/select.html#selecting-individual-attributes).
See SEARCH_VERIFICATION.md for the tests actually executed and their limits.

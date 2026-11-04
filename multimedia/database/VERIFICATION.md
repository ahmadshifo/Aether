# Task 10 MySQL correction: implementation and verification

Status: **code correction implemented; real MySQL 8.4 acceptance pending**.
The correction is not declared fully complete under the requested acceptance
condition, because no configured MySQL 8.4 connection is available.

## Files changed by this correction

| File | Responsibility |
| --- | --- |
| database/models.py | MySQL types, CHAR(36) UUID adapter, DATETIME(6) UTC adapter, JSON fields, checks and indexes |
| database/schema.py | Deterministic repeatable SQL generation with inline indexes |
| database/schema.sql | Generated MySQL 8.4 schema, matching ORM definitions |
| database/connection.py | Lazy PyMySQL engine, dotenv configuration, utf8mb4/UTC/strict sessions, version and schema checks, non-destructive initialization |
| database/validation.py | 1536 finite JSON floating-point values, keeping nonzero/model validation without obsolete float32 restriction |
| database/repository.py | MySQL expiry expression, duplicate error mapping and parameterized pagination; existing JPEG/transaction recovery preserved |
| database/compose.db.yml | Optional MySQL-only container with a new MySQL data volume |
| database/smoke.py | Real MySQL synthetic smoke test, separate-process persistence and targeted cleanup |
| database/__init__.py | Correct package description |
| tests/test_database.py | 69 offline tests, including UTC/UUID adapters, version rejection, JSON precision and schema drift |
| tests/test_database_integration.py | All 15 integration tests adapted to MySQL, including native JSON and UTC microseconds |
| api/requirements.txt | PyMySQL[rsa] added; existing dependencies retained |
| api/.env.example | Placeholder MySQL connection and optional Docker settings; no real credentials |
| README.md | Corrected Task 10 overview |
| database/README.md | Complete native Windows setup, schema, SQL grants, commands, storage behavior and Task 11 boundary |
| database/VERIFICATION.md | This report and Git snapshot |

Paths in the table are relative to multimedia/. database/errors.py was
inspected and left unchanged. The unused GitHub cleanup.py placeholder was
subsequently removed; it contained no implementation and had no callers.
Legacy psycopg/pgvector packages
remain solely for compatibility with the established Task 1 setup checks;
the active database layer imports neither. No previous task processing
algorithms were changed by this correction.

## Schema and exact setup commands

The complete schema is in [schema.sql](schema.sql); the column-by-column
reference and exact Windows/MySQL administrator SQL are in
[README.md](README.md#native-windows-11-setup-primary-option).

The frames table includes all 13 required columns: frame_id and session_id
CHAR(36); captured_at, created_at and expires_at DATETIME(6); optional source
index and video offset BIGINT; private image_path VARCHAR(1024); OCR LONGTEXT;
objects JSON; caption TEXT; nullable embedding JSON and model VARCHAR(100).
The table uses utf8mb4, with ASCII binary UUID/path columns. Indexes cover the
session/capture-time/frame-ID timeline and expiration. Expiry remains based
on insertion plus 24 hours by default. Missing embeddings are SQL NULL.

Install/configure MySQL Community 8.4 LTS, create aether_multimedia and its
dedicated account using the README's SQL, then edit the existing private
multimedia/api/.env while preserving AI credentials:

```dotenv
DATABASE_URL=mysql+pymysql://multimedia_user:YOUR_LOCAL_DATABASE_PASSWORD@localhost:3306/aether_multimedia?charset=utf8mb4
FRAME_STORAGE_PATH=./stored_frames
FRAME_RETENTION_HOURS=24
```

URL-encode special characters in the password. Do not overwrite the existing
.env with the example file. Commands from multimedia/ after activating .venv:

```powershell
python -m pip install -r api/requirements.txt
python -m database.connection --init
python -m database.connection --check
mysql -h localhost -P 3306 -u multimedia_user -p aether_multimedia
```

Inside MySQL:

```sql
SHOW TABLES;
SHOW CREATE TABLE frames\G
SHOW INDEX FROM frames;
```

Run the real integration tests and smoke test once that connection is ready:

```powershell
$env:RUN_MYSQL_TESTS = "1"
try {
    $pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
    python -m pytest tests/test_database_integration.py -v --basetemp "$pytestTemp" -p no:cacheprovider
}
finally {
    Remove-Item Env:\RUN_MYSQL_TESTS -ErrorAction SilentlyContinue
}
python -m database.repository --smoke-test
```

The README also contains the requested offline/full-suite commands and the
optional Docker alternative on a separate port. No server upgrade, service
change, root Compose modification, or PostgreSQL data transfer was attempted.

## Actual verification performed

| Check | Observed result |
| --- | --- |
| Offline Task 10 tests | **69 passed** |
| Full multimedia tests/ regression | **505 passed, 15 skipped**, 520 collected; no failures or errors |
| Previous-task regression | All 436 existing non-database tests included in the passing full run |
| Explicit RUN_MYSQL_TESTS=1 run | **15 setup errors**: DATABASE_URL missing; no test reached a MySQL server |
| python -m database.connection --init | Exit 1: DATABASE_URL missing |
| python -m database.connection --check | Exit 1: DATABASE_URL missing |
| python -m database.repository --smoke-test | Exit 1: DATABASE_URL missing; no test frames created |
| Dependency consistency | python -m pip check: No broken requirements found |
| Canonical schema consistency | Offline checks confirm schema.sql equals repeatable render_schema() output |
| Whitespace review | git diff --check passed |

Python is 3.13.7 on Windows. PyMySQL 1.2.3 and its RSA authentication dependencies
were installed in multimedia/.venv. Server discovery found mysql.exe/mysqld.exe
under MySQL Server 8.0, the MySQL80 Windows service, and a listener on 127.0.0.1:3306.
A read-only unauthenticated protocol greeting identified **8.0.43**. This is
not an authenticated MySQL 8.4 readiness check. No Docker executable was found.
The current private configuration does not provide DATABASE_URL.

No MySQL 8.4 schema execution, real JSON/vector round-trip, persisted frame,
or successful smoke result is claimed. The explicit integration run fails
visibly when opted in; it does not silently skip unsupported/missing servers.
Offline mocks and SQL compilation are not substitutes for server execution.

## Compatibility and Git

The Python repository retains save/get/list/count/load JPEG/delete/get embedding
interfaces and UUID/aware-UTC return values. The external fields frame_id,
session_id, timestamp, image_url, ocr_text, objects, caption and relevance_score
are unchanged. No mobile/, web/, shared/contracts/, API endpoints or repository
root docker-compose.yml were changed. No cloud AI requests were made. Task 11
search is documented only and has not been implemented.

Branch: feature/multimedia. No unresolved Git merge entries. No commit or push.
The working tree already contained earlier task changes; the following Git
snapshot includes those pre-existing changes as well as this correction.

```text
 M .gitignore
 M multimedia/README.md
 M multimedia/api/.env.example
 M multimedia/api/requirements.txt
 M multimedia/database/__init__.py
 M multimedia/database/connection.py
 M multimedia/database/repository.py
 M multimedia/database/schema.sql
 M multimedia/processing/duplicate_filter.py
 M multimedia/processing/frame_extractor.py
 M multimedia/processing/quality_filter.py
?? multimedia/database/README.md
?? multimedia/database/VERIFICATION.md
?? multimedia/database/compose.db.yml
?? multimedia/database/errors.py
?? multimedia/database/models.py
?? multimedia/database/schema.py
?? multimedia/database/smoke.py
?? multimedia/database/validation.py
?? multimedia/processing/caption_service.py
?? multimedia/processing/embedding_service.py
?? multimedia/processing/frame_selector.py
?? multimedia/processing/image_utils.py
?? multimedia/processing/object_detector.py
?? multimedia/processing/ocr_service.py
?? multimedia/processing/video_reader.py
?? multimedia/pytest.ini
?? multimedia/scripts/
?? multimedia/tests/
```

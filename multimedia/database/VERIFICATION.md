# Native MySQL connection and authentication verification

Verified on 2026-11-05 against the user's existing MySQL Community Server
8.0.43 at 127.0.0.1:3306, database multimedia_project. The user authorized
supporting this installed server instead of requiring an 8.4 upgrade.

Status: schema initialization, real frame storage, and existing signup/login
API flows passed. MySQL 8.0.17+ and 8.4 LTS are accepted; MariaDB and unsupported
version families remain rejected. Only 8.0.43 was exercised on a real server
in this session. The 8.4 version acceptance also has offline coverage.

## Tables created

- frames: existing 13-column multimedia schema, UTC DATETIME(6), objects and
  embeddings as native JSON, 1536 finite embedding floats and private JPEGs.
- users: UUID primary key, unique email, name, password_hash and UTC created_at.
- login_sessions: hashed refresh-token primary key, user UUID, creation/expiry
  timestamps, cleanup indexes, and foreign key to users with ON DELETE CASCADE.
- sessions: stream UUID, optional user UUID, live/ended status, start/end times,
  consent flag, account/status timeline index, and ON DELETE SET NULL user link.

The schema is generated from the same SQLAlchemy metadata for all four tables.
Initialization validates existing tables, creates missing tables/indexes and
never drops tables, replaces passwords or deletes application data. Frames
retain their independent session UUID API without requiring a stream row.

## Connection and backend configuration

multimedia/api/.env and web/ai-backend/.env privately configure the same server
and database using the supplied MySQL root account. A persistent JWT signing
secret is configured privately for the existing web authentication backend.
All unrelated private settings were preserved. Neither secrets file is tracked
by Git; public .env.example files contain only placeholders.

The backend parses quoted dotenv values, accepts process-environment overrides,
and can fall back to multimedia/api/.env for MYSQL_* database settings. Existing
API paths, request fields and response fields are preserved. No second login
implementation or alternative account database was introduced. The obsolete
python setup.py startup instruction was replaced with the actual initialization
command. Startup checks readiness of account, refresh and stream tables.

The MySQL root login is an infrastructure credential. Application users sign
up with their own email and password through the existing frontend; no default
application account has been seeded.

## Actual results

| Verification | Result |
| --- | --- |
| Offline database tests | 74 passed |
| Real frame-storage integration | Original 15 tests passed |
| Real authentication/stream integration | 8 new tests passed |
| Full tests/ run with RUN_MYSQL_TESTS=1 | 533 passed, no failures, no skipped tests |
| Real synthetic repository smoke test | Passed, including separate-process persistence and targeted cleanup |
| MySQL schema initialization and connection check | Passed on MySQL 8.0.43 |
| Dependency consistency | pip check passed |
| Public example credential checks | Passed |
| Git diff whitespace check | Passed |

The full run reported one upstream Starlette TestClient deprecation warning
about httpx. No runtime/test failures resulted. No live OpenAI or Mistral calls
were made. Tests exercise the existing ASGI authentication API with a real
MySQL database, not a mocked database or SQLite substitute. They do not claim
browser, live camera, or live AI end-to-end verification.

Authentication coverage includes signup and duplicate-email rejection; scrypt
password hashing and hashed refresh tokens; current-user lookup; incorrect and
correct passwords; logout/revocation; JWT refresh; expired-session rejection;
new-client login persistence; repeated initialization preserving a registered
account; and cross-account stream isolation. Synthetic users and sessions are
removed by their own generated identifiers. Normal signup/login only purges
expired refresh records belonging to the signing-in user.

Final observed row counts after cleanup: frames=0, users=0, login_sessions=0,
sessions=0. These counts describe this verification run, not a reset operation.
Real user data was not deleted and no demo credentials were left behind.

## Commands

From multimedia/ with its virtual environment active:

```powershell
python -m pip install -r api/requirements.txt
python -m pip install -r ../web/ai-backend/requirements.txt
python -m database.connection --init
python -m database.connection --check
python -m database.repository --smoke-test

$env:RUN_MYSQL_TESTS = "1"
try {
    $pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
    python -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider
}
finally {
    Remove-Item Env:\RUN_MYSQL_TESTS -ErrorAction SilentlyContinue
}

python -m uvicorn app.main --app-dir ../web/ai-backend --host 127.0.0.1 --port 8002
```

Workbench verification:

```sql
USE multimedia_project;
SHOW TABLES;
DESCRIBE users;
DESCRIBE login_sessions;
DESCRIBE sessions;
DESCRIBE frames;
```

Refresh Workbench's SCHEMAS panel to see the tables. Restart a backend that was
already running before configuration changed. Run the dashboard separately;
its existing Vite proxy forwards auth/stream requests to port 8002.

## Source changes

- database/models.py: canonical account, refresh-session and stream tables.
- database/schema.py and schema.sql: repeatable SQL for all four tables.
- database/connection.py: supported versions, generic table validation and init.
- database/compose.db.yml: consistent multimedia_project database default;
  the optional container still uses mysql:8.4.
- tests/test_database.py and test_database_integration.py: retain previous
  coverage and accept the supported server versions.
- tests/test_auth_database_integration.py: 8 real authentication/stream tests.
- web/ai-backend/app/auth.py: shared configuration fallback, proper dotenv
  parsing, UTC sessions, readiness checks and account-scoped expired cleanup.
- web/ai-backend/requirements.txt: dotenv dependency and verified PyJWT range.
- .env.example files and READMEs: current database name, setup and startup.

No frontend, API contract, server installation, or root Compose changes were
made. Task 11 semantic search was not implemented. Changes from this session
remain local and uncommitted; the database has been initialized locally.

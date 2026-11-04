# Task 10: MySQL Community 8.4 LTS and private JPEG storage

Task 10 uses SQLAlchemy 2.x, PyMySQL, MySQL native JSON and private local JPEGs.
The Python repository interfaces remain compatible with Tasks 1-9. No HTTP
endpoints, semantic search, cloud requests, or automatic expiration deletion
are implemented here. Task 11 will add retrieval.

## Native Windows 11 setup (primary option)

Install **MySQL Community Server 8.4 LTS**, not the Innovation release, from
[MySQL Community downloads](https://dev.mysql.com/downloads/mysql/8.4.html).
Use its Windows MSI and MySQL Configurator, configure a Windows service,
TCP/IP port (normally 3306), and a private administrator password. Add its
`bin` directory to PATH or invoke the executable by its absolute path.

Check an existing installation first:

```powershell
mysql --version
Get-Service -Name '*mysql*' -ErrorAction SilentlyContinue
mysql -h localhost -P 3306 -u root -p
```

Inside the MySQL client, verify the **server**, then provision this dedicated
schema and account. Replace the example password privately before running:

```sql
SELECT VERSION(), @@version_comment;
CREATE DATABASE IF NOT EXISTS aether_multimedia
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'multimedia_user'@'localhost'
  IDENTIFIED BY 'REPLACE_WITH_A_PRIVATE_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, REFERENCES
  ON aether_multimedia.* TO 'multimedia_user'@'localhost';
SHOW GRANTS FOR 'multimedia_user'@'localhost';
EXIT;
```

`CREATE USER IF NOT EXISTS` preserves an existing account's password. If that
account already exists, use its existing password or change it deliberately
as administrator. Application operations do not require global privileges,
DROP, or access to other databases. This application does not create database
accounts or modify server services.

A MySQL 8.0 installation is **not** the specified 8.4 target. Back up existing
data and use MySQL's documented upgrade process, or provision a separate 8.4
instance on another port. Do not replace another project's server blindly.
XAMPP commonly supplies **MariaDB**; its `mysql.exe` name does not establish
MySQL compatibility. `SELECT VERSION(), @@version_comment` identifies it.
The Python check rejects MariaDB and non-8.4 servers before initializing tables.
See [MySQL's upgrade documentation](https://dev.mysql.com/doc/refman/8.4/en/upgrading.html).

From the repository root:

```powershell
Set-Location multimedia
.\.venv\Scripts\Activate.ps1
python -m pip install -r api/requirements.txt
```

Edit your existing private `api/.env` (preserving its AI credentials):

```dotenv
DATABASE_URL=mysql+pymysql://multimedia_user:YOUR_LOCAL_DATABASE_PASSWORD@localhost:3306/aether_multimedia?charset=utf8mb4
FRAME_STORAGE_PATH=./stored_frames
FRAME_RETENTION_HOURS=24
```

Replace the placeholder and URL-encode password characters such as `@`, `:`,
`/`, `#`, and `%` in DATABASE_URL. The optional MYSQL_* settings in
`api/.env.example` configure Docker, not the native server. Python reads
DATABASE_URL directly, without interpolating other dotenv variables. Process
environment values override the file. Relative storage paths resolve from
`multimedia/`, independently of the shell working directory. Credentials and
stored images are ignored by Git; no actual `.env` is overwritten by setup.

Initialize and verify from `multimedia/`:

```powershell
python -m database.connection --init
python -m database.connection --check
mysql -h localhost -P 3306 -u multimedia_user -p aether_multimedia
```

In the MySQL client:

```sql
SHOW TABLES;
SHOW CREATE TABLE frames\G
SHOW INDEX FROM frames;
SELECT COLUMN_NAME, DATA_TYPE, DATETIME_PRECISION
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = 'frames';
SELECT COUNT(*) FROM frames;
EXIT;
```

`--init` verifies MySQL 8.4 first, creates a missing table and indexes, and
validates existing columns, primary/unique keys, named checks and table
encoding. Existing incompatible tables stop initialization for manual review;
no rows or tables are dropped or rewritten. MySQL DDL implicitly commits:
initialization is repeatable but is not an atomic multi-statement migration.
`database/schema.sql` is generated from `models.py`, includes inline indexes,
and is independently repeatable using `CREATE TABLE IF NOT EXISTS`. To use it
manually inside the client after selecting the database:

```sql
SOURCE database/schema.sql;
```

Still run `python -m database.connection --init` afterward to validate the
result. This correction changes the active storage backend; it does not
transfer any pre-existing PostgreSQL data to MySQL. Back up old data before
planning a separate data transfer. Legacy PostgreSQL volumes are untouched.

## Schema

| Column | MySQL type | Meaning |
| --- | --- | --- |
| frame_id | CHAR(36) PK | Canonical UUID; Python callers retain UUID objects |
| session_id | CHAR(36) NOT NULL | Session UUID |
| captured_at | DATETIME(6) NOT NULL | Capture wall-clock time, UTC |
| source_frame_index | BIGINT NULL | Original frame position, nonnegative |
| video_timestamp_ms | BIGINT NULL | Video offset; fractional input rounds half upward |
| image_path | VARCHAR(1024) NOT NULL UNIQUE | Private `session_uuid/frame_uuid.jpg` path |
| ocr_text | LONGTEXT NOT NULL | Original text, including Arabic |
| objects | JSON NOT NULL | Unmodified array of object labels; defaults to [] |
| caption | TEXT NOT NULL | Original caption |
| embedding | JSON NULL | 1536 finite floats, nonzero, or SQL NULL |
| embedding_model | VARCHAR(100) NULL | text-embedding-3-small, or NULL with no embedding |
| created_at | DATETIME(6) NOT NULL | Insertion time from UTC_TIMESTAMP(6) |
| expires_at | DATETIME(6) NOT NULL | Insertion time + retention (24 hours by default) |

All text metadata uses utf8mb4; paths and UUID columns use ASCII binary
collation because their characters are restricted to canonical UUID paths.
This also keeps the 1024-character unique path below InnoDB's index-byte limit.
The session timeline index covers `(session_id, captured_at DESC, frame_id DESC)`
for deterministic keyset pagination; a second index covers `expires_at`.
The database checks object-array structure, embedding dimensions/numeric JSON
items, model pairing, positions and retention. Python validates finite floats,
nonzero vectors, UUIDs, timestamps, labels and image data before filesystem writes.

MySQL DATETIME cannot retain timezone metadata. `UTCDateTime` rejects naive
caller inputs, converts aware values to naive UTC on writes, and restores
aware UTC on reads, preserving microseconds. PyMySQL sessions also enforce
UTC and strict SQL mode. Raw SQL readers see naive UTC values and must interpret
them accordingly. Creation/expiry use UTC server expressions, independent of
capture age. Missing embeddings remain SQL NULL, never zero vectors or JSON null.

See [MySQL expression defaults](https://dev.mysql.com/doc/refman/8.4/en/data-type-defaults.html),
[JSON schema checks](https://dev.mysql.com/doc/refman/8.4/en/json-validation-functions.html),
and [SQLAlchemy MySQL types](https://docs.sqlalchemy.org/en/20/dialects/mysql.html).
Regenerate the SQL artifact after model changes with:

```powershell
python -m database.schema --write
```

## Repository and storage behavior

```python
from datetime import UTC, datetime
from uuid import uuid4
import numpy as np
from database.connection import Database
from database.repository import FrameRepository, FrameCursor

with Database() as database:
    database.check()
    repository = FrameRepository.from_database(database)
    session_id = uuid4()
    frame_id = repository.save_frame(
        session_id, datetime.now(UTC), np.full((48, 64, 3), 150, dtype=np.uint8),
        ocr_text="ROOM 205", objects=["door", "sign"], caption="A door.",
        embedding=np.linspace(-0.5, 0.5, 1536).tolist(),
        embedding_model="text-embedding-3-small",
    )
    record = repository.get_frame(frame_id)
    recent = repository.list_frames(session_id, limit=20)
    older = repository.list_frames(session_id, before=FrameCursor(record.captured_at, frame_id))
    count = repository.count_frames(session_id)
    jpeg_bytes = repository.load_frame_image(frame_id)
    vector = repository.get_embedding(frame_id)
    repository.delete_frame(frame_id)
```

SQL is parameterized. JPEGs use exclusive creation, are never overwritten,
and are stored under validated UUID paths. Traversal, arbitrary stored paths,
and symlink redirects are rejected. Known insertion failures roll back and
remove only the new candidate JPEG. An uncertain commit retains the JPEG and
raises StorageConsistencyError rather than risking deletion of committed data.
Deletion locks the row, quarantines its JPEG, commits the row deletion, then
removes the quarantined file. A pre-commit failure restores the original file;
uncertain commits and post-commit unlink failures retain recovery artifacts
and report the problem. No automatic orphan cleanup or retention worker is
implemented. Local permissions are best effort; configure Windows directory
ACLs so only the application account can access stored_frames.

Image paths are internal. Future API responses must map them to authorized
image URLs; they must not expose filesystem paths. External contract fields
remain frame_id, session_id, timestamp, image_url, ocr_text, objects, caption,
and relevance_score. No contract files or existing endpoints are changed.

## Optional Docker alternative

Docker is not required. If native MySQL occupies port 3306, select an unused
port such as 3307 and update **both** MYSQL_PORT and DATABASE_URL in api/.env.
Set MYSQL_DATABASE=aether_multimedia, MYSQL_USER, MYSQL_PASSWORD and a separate
MYSQL_ROOT_PASSWORD there, then run from multimedia/:

```powershell
docker compose --env-file api/.env -f database/compose.db.yml up -d
docker compose --env-file api/.env -f database/compose.db.yml ps
python -m database.connection --init
python -m database.connection --check
# Stops containers while preserving database data:
docker compose --env-file api/.env -f database/compose.db.yml down
```

This uses mysql:8.4 with a dedicated **new** multimedia_mysql_data volume,
local-only published port, authenticated health check and first-boot schema
mount. It never reuses the previous PostgreSQL data directory. Container
credentials/database initialization apply only when its volume is new.
Do not remove persistent volumes as a routine setup step. The root repository
Compose configuration is unchanged.

## Verification

Run these from multimedia/ with the virtual environment active. All data is
synthetic; tests make no OpenAI or Mistral calls. Offline mocks check validation,
query construction and failure recovery; they do not establish server support.
The 15 real tests have been adapted to MySQL, not removed. They skip unless
RUN_MYSQL_TESTS=1; opting in makes configuration/version failures fail visibly.
Only generated test UUIDs are deleted. Avoid concurrent full-database cleanup
jobs during verification and use a dedicated test database when appropriate.

```powershell
$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/test_database.py -v --basetemp "$pytestTemp" -p no:cacheprovider

$env:RUN_MYSQL_TESTS = "1"
try {
    $pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
    python -m pytest tests/test_database_integration.py -v --basetemp "$pytestTemp" -p no:cacheprovider
}
finally {
    Remove-Item Env:\RUN_MYSQL_TESTS -ErrorAction SilentlyContinue
}

$pytestTemp = Join-Path $env:TEMP ("aether-pytest-" + [guid]::NewGuid().ToString("N"))
python -m pytest tests/ -v --basetemp "$pytestTemp" -p no:cacheprovider

# REAL DATABASE: requires --init first; four synthetic frames and two sessions.
python -m database.repository --smoke-test
```

The smoke test verifies metadata, a 1536-value embedding, JPEG decoding,
session isolation, chronological ordering, targeted deletion and persistence
in a separate Python process. It cleans only its own tracked frame UUIDs.
A failed server check creates no frame data.

## Task 11 preparation

For the small university demonstration dataset, Task 11 can fetch candidate
frames/JSON embeddings with session and capture-time filters, compute cosine
similarity with NumPy, rank matches in Python and return the most relevant
frames. Standard MySQL Community JSON storage provides no pgvector index;
this design is not optimized for millions of embeddings. Actual search and
relevance_score calculation remain outside Task 10.

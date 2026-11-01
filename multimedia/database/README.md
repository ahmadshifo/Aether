# Shared database (MySQL 8)

One MySQL database for all three members. `schema.sql` holds every table; `setup.py` creates the database, an app account and the tables.

| Tables | Owner |
|---|---|
| `users`, `login_sessions` | Member 2 (dashboard accounts) |
| `sessions` | Member 1 (one row per Start/Stop on the phone) |
| `frames`, `frame_objects` | Member 3 (stored frames, OCR, objects, embeddings) |
| `questions`, `question_evidence` | Member 2 (answers and the frames they used) |
| `warnings` | Bonus (warnings given without being asked) |

## Set up

1. Copy `.env.example` to `.env` and set `MYSQL_PASSWORD` to a new password for the app account. Never commit `.env`.
2. Install the driver and run the setup. It asks for the MySQL `root` password unless `.env` has it.

```bash
python -m venv multimedia/database/.venv
multimedia/database/.venv/Scripts/python -m pip install -r multimedia/database/requirements.txt
multimedia/database/.venv/Scripts/python multimedia/database/setup.py
```

Run `setup.py` again after `schema.sql` changes: it adds new tables and keeps existing ones and their rows. `setup.py --check` connects as the app account and lists the tables.

## Notes

- Services connect as `MYSQL_USER`, which can only read and write rows, not change tables.
- MySQL 8 has no vector type, so `frames.embedding` stores float32 bytes and similarity search runs in Python.
- Frame images stay on disk at `frames.image_path`; the cleanup job deletes the file and the row after `expires_at`.

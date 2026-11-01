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

## Start MySQL

MySQL runs as the Windows service `MySQL80` and starts with Windows. If it's stopped, start it from Services, or from an administrator terminal:

```bash
net start MySQL80
```

## Demo data

`setup.py --seed` creates the tables like a migrate, then loads demo data:

```bash
multimedia/database/.venv/Scripts/python multimedia/database/setup.py --seed
```

The demo data has one user, an ended session and a live session, 4 frames with objects and English, French and Arabic text, 3 questions with the frames they used, and a warning. It uses fixed IDs, so running it again replaces the demo rows instead of adding copies; other rows are left alone. The demo login is `demo@echosight.test` with password `echosight-demo`, for testing only. The image paths point to no real files.

## Notes

- Services connect as `MYSQL_USER`, which can only read and write rows, not change tables.
- MySQL 8 has no vector type, so `frames.embedding` stores float32 bytes and similarity search runs in Python.
- Frame images stay on disk at `frames.image_path`; the cleanup job deletes the file and the row after `expires_at`.

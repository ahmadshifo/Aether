"""Shared database: create the EchoSight MySQL database, its app account and every member's tables from multimedia/database/.env.

Run once, and again after schema.sql changes (existing tables are kept):
    python multimedia/database/setup.py            # uses the admin account, asks for its password if .env leaves it empty
    python multimedia/database/setup.py --seed     # the same, then loads the demo data below (safe to run again)
    python multimedia/database/setup.py --check    # connects as the app account and lists the tables
"""

import getpass
import hashlib
import re
import secrets
import struct
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pymysql

HERE = Path(__file__).resolve().parent
ENV_PATH = HERE / ".env"
SCHEMA_PATH = HERE / "schema.sql"
NAME_RE = re.compile(r"^[A-Za-z0-9_]{1,32}$")  # database and user names go into SQL unquoted, so only these characters
APP_HOSTS = ("localhost", "127.0.0.1")
APP_GRANTS = "SELECT, INSERT, UPDATE, DELETE"


def load_env() -> dict[str, str]:
    if not ENV_PATH.exists():
        sys.exit(f"Missing {ENV_PATH}. Copy .env.example to .env and fill it in.")
    env = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def setting(env: dict[str, str], key: str, name: bool = False) -> str:
    value = env.get(key, "")
    if not value:
        sys.exit(f"Set {key} in {ENV_PATH}.")
    if name and not NAME_RE.match(value):
        sys.exit(f"{key} may only use letters, digits and underscores.")
    return value


def schema_statements() -> list[str]:
    # Comments go first: some contain semicolons, which would split a statement in two.
    sql = re.sub(r"--[^\n]*", "", SCHEMA_PATH.read_text(encoding="utf-8"))
    return [statement.strip() for statement in sql.split(";") if statement.strip()]


def connect(env: dict[str, str], user: str, password: str, database: str | None = None) -> pymysql.Connection:
    try:
        return pymysql.connect(
            host=env.get("MYSQL_HOST", "127.0.0.1"), port=int(env.get("MYSQL_PORT", "3306")),
            user=user, password=password, database=database, charset="utf8mb4", autocommit=True,
        )
    except pymysql.err.OperationalError as error:
        sys.exit(f"Can't connect to MySQL as {user}: {error.args[-1]}")


def list_tables(conn: pymysql.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("SHOW TABLES")
        tables = [row[0] for row in cur.fetchall()]
        for table in tables:
            cur.execute(f"SELECT COUNT(*) FROM `{table}`")
            print(f"  {table:<18} {cur.fetchone()[0]} rows")
    print(f"{len(tables)} tables.")


def setup(env: dict[str, str]) -> None:
    database = setting(env, "MYSQL_DATABASE", name=True)
    app_user = setting(env, "MYSQL_USER", name=True)
    app_password = setting(env, "MYSQL_PASSWORD")
    admin_user = setting(env, "MYSQL_ADMIN_USER", name=True)
    admin_password = env.get("MYSQL_ADMIN_PASSWORD") or getpass.getpass(f"MySQL password for {admin_user}: ")

    with connect(env, admin_user, admin_password) as conn, conn.cursor() as cur:
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
        # When services use the admin account itself, leave it alone: creating or altering it would change root.
        for host in APP_HOSTS if app_user != admin_user else ():
            # ALTER keeps the password in step with .env when the account already exists.
            cur.execute(f"CREATE USER IF NOT EXISTS '{app_user}'@'{host}' IDENTIFIED BY %s", (app_password,))
            cur.execute(f"ALTER USER '{app_user}'@'{host}' IDENTIFIED BY %s", (app_password,))
            cur.execute(f"GRANT {APP_GRANTS} ON `{database}`.* TO '{app_user}'@'{host}'")
        cur.execute(f"USE `{database}`")
        for statement in schema_statements():
            cur.execute(statement)
    print(f"Database {database} is ready; services connect as {app_user}.")
    check(env)


def check(env: dict[str, str]) -> None:
    database = setting(env, "MYSQL_DATABASE", name=True)
    with connect(env, setting(env, "MYSQL_USER", name=True), setting(env, "MYSQL_PASSWORD"), database) as conn:
        list_tables(conn)


# ---------- demo data ----------

# Fixed IDs so seeding again replaces the demo rows instead of adding copies.
DEMO_USER = "00000000-0000-4000-8000-000000000001"
DEMO_EMAIL, DEMO_PASSWORD = "demo@echosight.test", "echosight-demo"  # test login only, never a real account
DEMO_SESSIONS = ("00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000102")
DEMO_FRAMES = tuple(f"00000000-0000-4000-8000-0000000002{n:02d}" for n in range(1, 5))
DEMO_QUESTIONS = tuple(f"00000000-0000-4000-8000-0000000003{n:02d}" for n in range(1, 4))
DEMO_WARNING = "00000000-0000-4000-8000-000000000401"


def demo_password_hash() -> str:
    # Same scrypt format as web/ai-backend/app/auth.py, so the demo login works once auth uses MySQL.
    n, r, p, salt = 2**14, 8, 1, secrets.token_bytes(16)
    digest = hashlib.scrypt(DEMO_PASSWORD.encode(), salt=salt, n=n, r=r, p=p, dklen=32)
    return f"scrypt${n}${r}${p}${salt.hex()}${digest.hex()}"


def demo_embedding(seed: int) -> bytes:
    # A small fake float32 vector; real ones come from Member 3's embedding model.
    return struct.pack("8f", *((seed * 7 + i * 3) % 10 / 10 for i in range(8)))


def seed(env: dict[str, str]) -> None:
    database = setting(env, "MYSQL_DATABASE", name=True)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    ago = lambda minutes: now - timedelta(minutes=minutes)
    keep = now + timedelta(days=30)  # long enough that the cleanup job leaves the demo frames alone
    ended, live = DEMO_SESSIONS
    f1, f2, f3, f4 = DEMO_FRAMES
    q1, q2, q3 = DEMO_QUESTIONS

    with connect(env, setting(env, "MYSQL_USER", name=True), setting(env, "MYSQL_PASSWORD"), database) as conn, conn.cursor() as cur:
        # Cascades remove everything under the demo user and sessions, plus evidence rows of their questions.
        cur.execute("DELETE FROM sessions WHERE session_id IN (%s, %s)", DEMO_SESSIONS)
        cur.execute("DELETE FROM users WHERE user_id = %s OR email = %s", (DEMO_USER, DEMO_EMAIL))

        cur.execute(
            "INSERT INTO users (user_id, email, name, password_hash, preferred_language, speech_rate, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (DEMO_USER, DEMO_EMAIL, "Demo User", demo_password_hash(), "en", 1.0, ago(60 * 24)),
        )
        cur.executemany(
            "INSERT INTO sessions (session_id, user_id, status, started_at, ended_at, consent_given) VALUES (%s, %s, %s, %s, %s, TRUE)",
            [(ended, DEMO_USER, "ended", ago(120), ago(95)), (live, DEMO_USER, "live", ago(10), None)],
        )
        cur.executemany(
            "INSERT INTO frames (frame_id, session_id, captured_at, image_path, caption, ocr_text, ocr_confidence, ocr_language, "
            "sharpness, brightness, enhanced, embedding, embedding_model, expires_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'demo', %s)",
            [
                (f1, ended, ago(110), "seed/kitchen.jpg", "A kitchen counter with a cup and a medicine box",
                 "Paracetamol 500 mg - take 1 tablet every 6 hours", 0.93, "en", 0.82, 0.61, False, demo_embedding(1), keep),
                (f2, ended, ago(100), "seed/street.jpg", "A street crossing with a traffic light",
                 "", None, None, 0.74, 0.55, False, demo_embedding(2), keep),
                (f3, live, ago(8), "seed/door.jpg", "A closed wooden door with a sign",
                 "Sortie de secours", 0.88, "fr", 0.79, 0.38, True, demo_embedding(3), keep),
                (f4, live, ago(2), "seed/shop.jpg", "A shop front with an Arabic sign",
                 "صيدلية", 0.71, "ar", 0.66, 0.70, False, demo_embedding(4), keep),
            ],
        )
        cur.executemany(
            "INSERT INTO frame_objects (frame_id, label, confidence, position, box_x, box_y, box_w, box_h) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            [
                (f1, "cup", 0.91, "left", 0.10, 0.40, 0.20, 0.30),
                (f1, "box", 0.84, "center", 0.45, 0.35, 0.25, 0.35),
                (f2, "traffic light", 0.89, "right", 0.70, 0.05, 0.10, 0.30),
                (f2, "car", 0.77, "left", 0.00, 0.50, 0.35, 0.30),
                (f3, "door", 0.95, "center", 0.25, 0.05, 0.50, 0.90),
                (f4, "person", 0.68, "right", 0.65, 0.30, 0.20, 0.60),
            ],
        )
        cur.executemany(
            "INSERT INTO questions (question_id, session_id, user_id, asked_at, question, answer, language, uncertain, confidence, "
            "refused, model, stt_ms, search_ms, ai_ms, total_ms, feedback, feedback_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            [
                (q1, ended, DEMO_USER, ago(105), "How often can I take this medicine?",
                 "The box says to take 1 tablet every 6 hours.", "en", False, 0.90, False, "demo",
                 420, 35, 900, 1400, "correct", ago(104)),
                (q2, live, DEMO_USER, ago(7), "Qu'est-ce qui est écrit sur la porte ?",
                 "La porte indique « Sortie de secours ».", "fr", False, 0.85, False, "demo",
                 380, 30, 850, 1300, None, None),
                (q3, live, DEMO_USER, ago(1), "ما اسم هذا المحل؟",
                 "لست متأكدًا، لكن اللافتة تبدو وكأنها تقول «صيدلية».", "ar", True, 0.45, False, "demo",
                 450, 40, 950, 1500, None, None),
            ],
        )
        cur.executemany(
            "INSERT INTO question_evidence (question_id, frame_id, `rank`, relevance) VALUES (%s, %s, %s, %s)",
            [(q1, f1, 1, 0.92), (q2, f3, 1, 0.88), (q3, f4, 1, 0.61), (q3, f3, 2, 0.20)],
        )
        cur.execute(
            "INSERT INTO warnings (warning_id, session_id, frame_id, created_at, kind, message, language, confidence) "
            "VALUES (%s, %s, %s, %s, 'closed_door', 'Closed door ahead.', 'en', 0.95)",
            (DEMO_WARNING, live, f3, ago(8)),
        )
    print(f"Demo data loaded: login {DEMO_EMAIL}, one ended and one live session.")
    check(env)


if __name__ == "__main__":
    settings = load_env()
    if "--check" in sys.argv[1:]:
        check(settings)
    else:
        setup(settings)
        if "--seed" in sys.argv[1:]:
            seed(settings)

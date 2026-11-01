"""Shared database: create the EchoSight MySQL database, its app account and every member's tables from multimedia/database/.env.

Run once, and again after schema.sql changes (existing tables are kept):
    python multimedia/database/setup.py            # uses the admin account, asks for its password if .env leaves it empty
    python multimedia/database/setup.py --check    # connects as the app account and lists the tables
"""

import getpass
import re
import sys
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


if __name__ == "__main__":
    settings = load_env()
    check(settings) if "--check" in sys.argv[1:] else setup(settings)

"""`npm run db:clear`: empties the aether_multimedia tables after a backup. The tables themselves stay."""
import datetime
import os
import pathlib
import subprocess
import sys

import pymysql

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Children first, so the links between tables stay valid while rows go.
TABLES = ("frames", "login_sessions", "sessions", "users")
MYSQL_DIR = pathlib.Path(os.getenv("AETHER_MYSQL_DIR", pathlib.Path.home() / "mysql84"))


def read_env(path):
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.strip().partition("=")
        if sep and key and not key.startswith("#"):
            values[key] = value
    return values


env = read_env(ROOT / "web/ai-backend/.env")
conn = pymysql.connect(host=env["MYSQL_HOST"], port=int(env["MYSQL_PORT"]), user=env["MYSQL_USER"],
                       password=env["MYSQL_PASSWORD"], database=env["MYSQL_DATABASE"])
with conn, conn.cursor() as cur:
    print(f"Database {env['MYSQL_DATABASE']} on port {env['MYSQL_PORT']}:")
    for table in TABLES:
        cur.execute(f"SELECT COUNT(*) FROM `{table}`")
        print(f"  {table}: {cur.fetchone()[0]} rows")
    print("\nThis deletes every row above, including all accounts. Everyone must sign up again.")
    if input("Type DELETE to continue: ").strip() != "DELETE":
        sys.exit("Nothing was changed.")

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = MYSQL_DIR / f"{env['MYSQL_DATABASE']}-backup-{stamp}.sql"
    subprocess.run(
        [str(next(MYSQL_DIR.glob("mysql-*/bin/mysqldump.exe"))), "-h", env["MYSQL_HOST"], "-P", env["MYSQL_PORT"],
         "-u", env["MYSQL_USER"], "--databases", env["MYSQL_DATABASE"], "--single-transaction", "--no-tablespaces",
         f"--result-file={backup}"],
        check=True, env={**os.environ, "MYSQL_PWD": env["MYSQL_PASSWORD"]},
    )
    print(f"Backup saved: {backup}")

    for table in TABLES:
        cur.execute(f"DELETE FROM `{table}`")
        print(f"  {table}: {cur.rowcount} rows deleted")
    conn.commit()
print("Done. The database is empty.")

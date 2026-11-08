"""Lazy SQLAlchemy/PyMySQL connections and explicit MySQL Community 8.4 setup."""

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import CheckConstraint, create_engine, inspect, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import sessionmaker

from .errors import DatabaseConfigurationError, DatabaseConnectionError, DatabaseError
from .object_storage import S3Settings

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = PROJECT_ROOT / "api" / ".env"


@dataclass(frozen=True)
class DatabaseSettings:
    url: URL = field(repr=False)
    storage_root: Path
    retention_hours: int = 24
    # "local" keeps JPEGs under storage_root; "s3" keeps them in RustFS (S3-compatible) using `s3`.
    storage_backend: str = "local"
    s3: S3Settings | None = None


def _load_s3_settings(values) -> S3Settings:
    def setting(name, default=None):
        value = os.environ.get(name, values.get(name, default))
        return value.strip() if isinstance(value, str) else value
    endpoint, bucket = setting("S3_ENDPOINT_URL"), setting("S3_BUCKET", "aether-frames")
    access, secret = setting("S3_ACCESS_KEY_ID"), setting("S3_SECRET_ACCESS_KEY")
    if not all((endpoint, bucket, access, secret)) or not endpoint.startswith(("http://", "https://")):
        raise DatabaseConfigurationError(
            "FRAME_STORAGE_BACKEND=s3 needs S3_ENDPOINT_URL, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY; credentials were suppressed.")
    return S3Settings(endpoint, bucket, access, secret, setting("S3_REGION", "us-east-1") or "us-east-1")


def load_settings(database_url=None, storage_path=None, retention_hours=None, storage_backend=None) -> DatabaseSettings:
    try:
        values = dotenv_values(ENV_FILE, interpolate=False)
        raw_url = database_url if database_url is not None else os.environ.get("DATABASE_URL", values.get("DATABASE_URL"))
        if not raw_url:
            raise DatabaseConfigurationError("DATABASE_URL is missing; configure api/.env or the environment.")
        url = make_url(raw_url)
        if url.drivername != "mysql+pymysql" or not all((url.username, url.password, url.host, url.database)):
            raise ValueError()
        if url.query.get("charset", "utf8mb4") != "utf8mb4":
            raise ValueError()
        url = url.update_query_dict({"charset": "utf8mb4"})
        storage = storage_path if storage_path is not None else os.environ.get("FRAME_STORAGE_PATH", values.get("FRAME_STORAGE_PATH", "./stored_frames"))
        if not storage:
            raise ValueError()
        root = Path(storage)
        root = (PROJECT_ROOT / root).resolve() if not root.is_absolute() else root.resolve()
        hours = retention_hours if retention_hours is not None else os.environ.get("FRAME_RETENTION_HOURS", values.get("FRAME_RETENTION_HOURS", "24"))
        if isinstance(hours, bool) or str(int(hours)) != str(hours).strip() or int(hours) <= 0:
            raise ValueError()
        backend = storage_backend if storage_backend is not None else os.environ.get(
            "FRAME_STORAGE_BACKEND", values.get("FRAME_STORAGE_BACKEND", "local"))
        backend = str(backend or "local").strip().lower()
        if backend not in ("local", "s3"):
            raise ValueError()
        s3 = _load_s3_settings(values) if backend == "s3" else None
        return DatabaseSettings(url, root, int(hours), backend, s3)
    except DatabaseError:
        raise
    except Exception:
        raise DatabaseConfigurationError("Invalid database URL, storage directory, storage backend, or retention configuration; credentials were suppressed.") from None


def create_db_engine(settings: DatabaseSettings):
    try:
        return create_engine(
            settings.url, pool_pre_ping=True, pool_timeout=5, echo=False, hide_parameters=True,
            connect_args={"connect_timeout": 5, "read_timeout": 15, "write_timeout": 15,
                          "init_command": "SET SESSION time_zone = '+00:00', "
                          "sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_DATE,"
                          "NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"},
        )
    except Exception:
        raise DatabaseConnectionError("Could not configure MySQL/PyMySQL; credentials were suppressed.") from None


class Database:
    def __init__(self, settings: DatabaseSettings | None = None):
        self.settings = settings if settings is not None else load_settings()
        self.engine = create_db_engine(self.settings)  # Does not connect yet.
        self.sessions = sessionmaker(bind=self.engine, expire_on_commit=False)

    @staticmethod
    def _server_version(connection) -> str:
        version = str(connection.scalar(text("SELECT VERSION()")))
        comment = str(connection.scalar(text("SELECT @@version_comment")))
        if "mariadb" in (version + comment).lower() or not re.fullmatch(r"8\.4\.\d+(?:[-.][A-Za-z0-9_.-]+)?", version):
            raise DatabaseConnectionError("MySQL Community Server 8.4 LTS is required; MySQL 8.0 and MariaDB are not supported targets.")
        return version

    @staticmethod
    def _validate_schema(connection):
        from .models import Frame
        from sqlalchemy.types import TypeDecorator
        inspector = inspect(connection)
        if not inspector.has_table("frames"):
            raise DatabaseConnectionError("The frames table is missing; run --init.")
        actual = {column["name"]: column for column in inspector.get_columns("frames")}
        expected = Frame.__table__
        compatible = set(actual) == set(expected.columns.keys())
        for column in expected.columns:
            if column.name not in actual:
                continue
            definition = actual[column.name]
            wanted = column.type.impl if isinstance(column.type, TypeDecorator) else column.type
            found = definition["type"]
            compatible &= isinstance(found, type(wanted)) and definition["nullable"] == column.nullable
            for attribute in ("length", "fsp"):
                compatible &= getattr(found, attribute, None) == getattr(wanted, attribute, None)
            compatible &= bool(getattr(found, "unsigned", False)) == bool(getattr(wanted, "unsigned", False))
            if column.name in ("frame_id", "session_id", "image_path"):
                compatible &= getattr(found, "charset", None) == "ascii"
                compatible &= getattr(found, "collation", None) == "ascii_bin"
            elif column.name in ("ocr_text", "caption", "embedding_model"):
                compatible &= getattr(found, "charset", None) in (None, "utf8mb4")
        compatible &= inspector.get_pk_constraint("frames")["constrained_columns"] == ["frame_id"]
        unique_keys = inspector.get_unique_constraints("frames")
        compatible &= any(key["column_names"] == ["image_path"] for key in unique_keys)
        checks = {check["name"] for check in inspector.get_check_constraints("frames")}
        compatible &= {constraint.name for constraint in expected.constraints
                       if isinstance(constraint, CheckConstraint)} <= checks
        indexes = {index["name"]: index for index in inspector.get_indexes("frames")}
        for index in expected.indexes:
            if index.name in indexes:
                compatible &= indexes[index.name]["column_names"] == list(index.columns.keys())
        options = inspector.get_table_options("frames")
        compatible &= options.get("mysql_engine", "").lower() == "innodb"
        compatible &= options.get("mysql_collate", "").startswith("utf8mb4_")
        if not compatible:
            raise DatabaseConnectionError("Existing frames schema is incompatible; initialization will not rewrite or drop it. Review the schema manually.")

    def check(self) -> dict:
        try:
            with self.engine.connect() as connection:
                version = self._server_version(connection)
                self._validate_schema(connection)
                indexes = {item["name"] for item in inspect(connection).get_indexes("frames")}
                if not {"frames_session_time_idx", "frames_expires_at_idx"} <= indexes:
                    raise DatabaseConnectionError("Required frames indexes are missing; run --init.")
            return {"mysql_version": version, "frames_table": "frames"}
        except DatabaseError:
            raise
        except Exception:
            raise DatabaseConnectionError("MySQL connection/readiness check failed; verify server, credentials and schema initialization.") from None

    def initialize_schema(self):
        from .models import Frame
        from .schema import SCHEMA_FILE, create_table_sql, render_schema
        if SCHEMA_FILE.read_text(encoding="utf-8") != render_schema():
            raise DatabaseConfigurationError("schema.sql differs from models; regenerate with python -m database.schema --write.")
        try:
            # MySQL DDL implicitly commits. Only create missing objects; never
            # claim atomic schema migration or rewrite an incompatible table.
            with self.engine.begin() as connection:
                self._server_version(connection)
                if inspect(connection).has_table("frames"):
                    self._validate_schema(connection)
                else:
                    connection.exec_driver_sql(create_table_sql())
                for index in sorted(Frame.__table__.indexes, key=lambda item: item.name):
                    index.create(connection, checkfirst=True)
                self._validate_schema(connection)
        except DatabaseError:
            raise
        except Exception:
            raise DatabaseConnectionError("MySQL schema initialization failed. Existing records were not deleted; inspect permissions and schema compatibility.") from None

    def close(self):
        self.engine.dispose()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--init", action="store_true", help="Create missing schema objects, never drop records")
    args = parser.parse_args(argv)
    if not args.check and not args.init:
        parser.error("Specify --check or --init")
    try:
        with Database() as database:
            if args.init:
                database.initialize_schema()
                print("Schema initialized without deleting records")
            print("Checking MySQL Community Server 8.4 LTS...")
            info = database.check()
            print("Connection successful")
            print(f"MySQL version: {info['mysql_version']}")
            print("Database ready")
        return 0
    except DatabaseError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

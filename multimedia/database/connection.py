"""Lazy SQLAlchemy/PyMySQL connections and explicit MySQL Community 8.0/8.4 setup."""

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import Boolean, CheckConstraint, UniqueConstraint, create_engine, inspect, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.orm import sessionmaker

from .errors import DatabaseConfigurationError, DatabaseConnectionError, DatabaseError

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = PROJECT_ROOT / "api" / ".env"


@dataclass(frozen=True)
class DatabaseSettings:
    url: URL = field(repr=False)
    storage_root: Path
    retention_hours: int = 24


def load_settings(database_url=None, storage_path=None, retention_hours=None) -> DatabaseSettings:
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
        return DatabaseSettings(url, root, int(hours))
    except DatabaseError:
        raise
    except Exception:
        raise DatabaseConfigurationError("Invalid database URL, storage directory, or retention configuration; credentials were suppressed.") from None


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
        match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:[-.][A-Za-z0-9_.-]+)?", version)
        supported = bool(match) and ((int(match[1]), int(match[2])) == (8, 4) or
                                     ((int(match[1]), int(match[2])) == (8, 0) and int(match[3]) >= 17))
        if "mariadb" in (version + comment).lower() or not supported:
            raise DatabaseConnectionError("MySQL Community Server 8.0.17+ or 8.4 LTS is required; MariaDB is not supported.")
        return version

    @staticmethod
    def _validate_schema(connection, table=None):
        from .models import Frame
        from sqlalchemy.types import TypeDecorator
        expected = Frame.__table__ if table is None else table
        table_name = expected.name
        inspector = inspect(connection)
        if not inspector.has_table(table_name):
            raise DatabaseConnectionError(f"The {table_name} table is missing; run --init.")
        actual = {column["name"]: column for column in inspector.get_columns(table_name)}
        compatible = set(actual) == set(expected.columns.keys())
        for column in expected.columns:
            if column.name not in actual:
                continue
            definition = actual[column.name]
            wanted = column.type.impl if isinstance(column.type, TypeDecorator) else column.type
            found = definition["type"]
            type_matches = isinstance(found, type(wanted))
            if isinstance(wanted, Boolean):
                from sqlalchemy.dialects.mysql import TINYINT
                type_matches = isinstance(found, (Boolean, TINYINT))
            compatible &= type_matches and definition["nullable"] == column.nullable
            for attribute in ("length", "fsp"):
                compatible &= getattr(found, attribute, None) == getattr(wanted, attribute, None)
            compatible &= bool(getattr(found, "unsigned", False)) == bool(getattr(wanted, "unsigned", False))
            if getattr(wanted, "charset", None) == "ascii":
                compatible &= getattr(found, "charset", None) == "ascii"
                compatible &= getattr(found, "collation", None) == "ascii_bin"
            elif hasattr(wanted, "charset"):
                compatible &= getattr(found, "charset", None) in (None, "utf8mb4")
        compatible &= inspector.get_pk_constraint(table_name)["constrained_columns"] == list(expected.primary_key.columns.keys())
        unique_keys = inspector.get_unique_constraints(table_name)
        for constraint in expected.constraints:
            if isinstance(constraint, UniqueConstraint):
                compatible &= any(key["column_names"] == list(constraint.columns.keys()) for key in unique_keys)
        checks = {check["name"] for check in inspector.get_check_constraints(table_name)}
        compatible &= {constraint.name for constraint in expected.constraints
                       if isinstance(constraint, CheckConstraint)} <= checks
        indexes = {index["name"]: index for index in inspector.get_indexes(table_name)}
        for index in expected.indexes:
            if index.name in indexes:
                compatible &= indexes[index.name]["column_names"] == list(index.columns.keys())
        options = inspector.get_table_options(table_name)
        compatible &= options.get("mysql_engine", "").lower() == "innodb"
        compatible &= options.get("mysql_collate", "").startswith("utf8mb4_")
        if not compatible:
            raise DatabaseConnectionError(f"Existing {table_name} schema is incompatible; initialization will not rewrite or drop it. Review the schema manually.")

    def check(self) -> dict:
        try:
            with self.engine.connect() as connection:
                version = self._server_version(connection)
                from .models import Base
                for table in Base.metadata.sorted_tables:
                    self._validate_schema(connection, table)
                    indexes = {item["name"] for item in inspect(connection).get_indexes(table.name)}
                    if not {index.name for index in table.indexes} <= indexes:
                        raise DatabaseConnectionError(f"Required {table.name} indexes are missing; run --init.")
            return {"mysql_version": version, "frames_table": "frames"}
        except DatabaseError:
            raise
        except Exception:
            raise DatabaseConnectionError("MySQL connection/readiness check failed; verify server, credentials and schema initialization.") from None

    def initialize_schema(self):
        from .models import Base
        from .schema import SCHEMA_FILE, create_table_sql, render_schema
        if SCHEMA_FILE.read_text(encoding="utf-8") != render_schema():
            raise DatabaseConfigurationError("schema.sql differs from models; regenerate with python -m database.schema --write.")
        try:
            # MySQL DDL implicitly commits. Validate existing tables before
            # adding objects; never rewrite incompatible tables or delete rows.
            with self.engine.begin() as connection:
                self._server_version(connection)
                for table in Base.metadata.sorted_tables:
                    if inspect(connection).has_table(table.name):
                        self._validate_schema(connection, table)
                for table in Base.metadata.sorted_tables:
                    if not inspect(connection).has_table(table.name):
                        connection.exec_driver_sql(create_table_sql(table))
                    for index in sorted(table.indexes, key=lambda item: item.name):
                        index.create(connection, checkfirst=True)
                    self._validate_schema(connection, table)
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
            print("Checking MySQL Community Server 8.0.17+ / 8.4 LTS...")
            info = database.check()
            print("Connection successful")
            print(f"MySQL version: {info['mysql_version']}")
            print("Tables ready: frames, users, login_sessions, sessions")
            print("Database ready")
        return 0
    except DatabaseError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

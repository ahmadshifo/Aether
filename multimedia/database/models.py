"""Canonical MySQL models with explicit UUID and UTC conversion."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, Index, UniqueConstraint, text
from sqlalchemy.dialects.mysql import CHAR, DATETIME, ENUM, JSON, LONGTEXT, TEXT, VARCHAR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

EMBEDDING_DIMENSIONS = 1536
EMBEDDING_MODEL = "text-embedding-3-small"


class UUIDString(TypeDecorator):
    """Preserve Python UUID values, storing canonical CHAR(36) strings."""
    impl = CHAR(36, charset="ascii", collation="ascii_bin")
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return None if value is None else str(UUID(str(value)))

    def process_result_value(self, value, dialect):
        return None if value is None else UUID(value)


class UTCDateTime(TypeDecorator):
    """Bind aware inputs as naive UTC; restore UTC on DATETIME(6) reads."""
    impl = DATETIME(fsp=6)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if not isinstance(value, datetime) or value.utcoffset() is None:
            raise ValueError("A timezone-aware datetime is required.")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class Base(DeclarativeBase):
    pass


TABLE_OPTIONS = {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_0900_ai_ci"}


class Account(Base):
    """Accounts used by the existing web/mobile authentication API."""
    __tablename__ = "users"
    user_id: Mapped[UUID] = mapped_column(UUIDString(), primary_key=True)
    email: Mapped[str] = mapped_column(VARCHAR(254), nullable=False)
    name: Mapped[str] = mapped_column(VARCHAR(80), nullable=False)
    password_hash: Mapped[str] = mapped_column(VARCHAR(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False,
                                               server_default=text("(UTC_TIMESTAMP(6))"))
    __table_args__ = (UniqueConstraint("email", name="users_email_unique"), TABLE_OPTIONS.copy())


class LoginSession(Base):
    """Only the SHA-256 hash of the random refresh token is stored."""
    __tablename__ = "login_sessions"
    token_hash: Mapped[str] = mapped_column(CHAR(64, charset="ascii", collation="ascii_bin"), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(UUIDString(), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    __table_args__ = (
        Index("login_sessions_expires_idx", "expires_at"),
        Index("login_sessions_created_idx", "created_at"),
        CheckConstraint("expires_at > created_at", name="login_sessions_retention_valid"),
        TABLE_OPTIONS.copy(),
    )


class StreamSession(Base):
    """Connect a phone stream UUID to its signed-in account."""
    __tablename__ = "sessions"
    session_id: Mapped[UUID] = mapped_column(UUIDString(), primary_key=True)
    user_id: Mapped[UUID | None] = mapped_column(UUIDString(), ForeignKey("users.user_id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(ENUM("live", "ended"), nullable=False, server_default=text("'live'"))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    consent_given: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("0"))
    __table_args__ = (Index("sessions_user_status_idx", "user_id", "status", "started_at"), TABLE_OPTIONS.copy())


class Frame(Base):
    __tablename__ = "frames"

    frame_id: Mapped[UUID] = mapped_column(UUIDString(), primary_key=True)
    session_id: Mapped[UUID] = mapped_column(UUIDString(), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    source_frame_index: Mapped[int | None] = mapped_column(BigInteger)
    video_timestamp_ms: Mapped[int | None] = mapped_column(BigInteger)
    # UUID paths are ASCII. This keeps the unique key below InnoDB's 3072-byte
    # limit even though the required path column has 1024 characters.
    image_path: Mapped[str] = mapped_column(VARCHAR(1024, charset="ascii", collation="ascii_bin"), nullable=False)
    ocr_text: Mapped[str] = mapped_column(LONGTEXT, nullable=False, server_default=text("('')"))
    objects: Mapped[list[str]] = mapped_column(JSON, nullable=False, server_default=text("(JSON_ARRAY())"))
    caption: Mapped[str] = mapped_column(TEXT, nullable=False, server_default=text("('')"))
    embedding: Mapped[list[float] | None] = mapped_column(JSON(none_as_null=True))
    embedding_model: Mapped[str | None] = mapped_column(VARCHAR(100))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False,
                                               server_default=text("(UTC_TIMESTAMP(6))"))
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False,
                                               server_default=text("(UTC_TIMESTAMP(6) + INTERVAL 24 HOUR)"))

    __table_args__ = (
        UniqueConstraint("image_path", name="frames_image_path_unique"),
        CheckConstraint("length(image_path) > 0", name="frames_image_path_nonempty"),
        CheckConstraint("source_frame_index IS NULL OR source_frame_index >= 0", name="frames_source_index_valid"),
        CheckConstraint("video_timestamp_ms IS NULL OR video_timestamp_ms >= 0", name="frames_video_time_valid"),
        CheckConstraint("expires_at > created_at", name="frames_retention_valid"),
        CheckConstraint("JSON_SCHEMA_VALID('{\"type\":\"array\",\"items\":{\"type\":\"string\",\"minLength\": 1}}', objects)",
                        name="frames_objects_valid"),
        CheckConstraint("(embedding IS NULL AND embedding_model IS NULL) OR "
                        "(embedding IS NOT NULL AND embedding_model IS NOT NULL AND "
                        "embedding_model = 'text-embedding-3-small')", name="frames_embedding_model_valid"),
        CheckConstraint("embedding IS NULL OR JSON_SCHEMA_VALID('{\"type\":\"array\",\"minItems\": 1536,"
                        "\"maxItems\": 1536,\"items\":{\"type\":\"number\"}}', embedding)", name="frames_embedding_valid"),
        TABLE_OPTIONS.copy(),
    )


Index("frames_session_time_idx", Frame.session_id, Frame.captured_at.desc(), Frame.frame_id.desc())
Index("frames_expires_at_idx", Frame.expires_at)

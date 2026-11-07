"""Trusted CLI/environment live settings; never populated from an HTTP URL."""

from dataclasses import dataclass, field
import math
import os
from pathlib import Path
import re
from urllib.parse import urlsplit, urlunsplit

from dotenv import dotenv_values

from database.validation import as_uuid

ENV_FILE = Path(__file__).resolve().parents[1] / "api" / ".env"


def values_from_env():
    return {**dotenv_values(ENV_FILE, interpolate=False), **os.environ}


def positive(value, name, minimum=.01, maximum=86400):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not minimum <= value <= maximum:
        raise ValueError(f"Invalid {name}; expected a finite number within configured bounds.")


def integer(value, name, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"Invalid {name}; expected an integer within configured bounds.")


@dataclass(frozen=True)
class StreamSettings:
    # Reuse the team's existing variable instead of adding a competing host/template.
    url_template: str = field(default="rtsp://localhost:8554/live/SESSION_ID", repr=False)
    transport: str = "tcp"
    open_timeout_seconds: float = 5
    read_timeout_seconds: float = 10
    reconnect_initial_seconds: float = 1
    reconnect_max_seconds: float = 15
    max_reconnect_attempts: int = 8

    def __post_init__(self):
        if self.transport != "tcp":
            raise ValueError("This live reader requires RTSP over TCP.")
        for name in ("open_timeout_seconds", "read_timeout_seconds", "reconnect_initial_seconds", "reconnect_max_seconds"):
            positive(getattr(self, name), name, .01, 300)
        if self.reconnect_max_seconds < self.reconnect_initial_seconds:
            raise ValueError("Maximum reconnect delay must cover the initial delay.")
        integer(self.max_reconnect_attempts, "max_reconnect_attempts", 0, 1000)
        self.build_url("550e8400-e29b-41d4-a716-446655440000", validate_template=True)

    def build_url(self, session_id, *, host=None, port=None, validate_template=False):
        sid = as_uuid(session_id, "session_id")
        try:
            if not isinstance(self.url_template, str) or any(c.isspace() for c in self.url_template):
                raise ValueError()
            parts = urlsplit(self.url_template)
            if parts.scheme != "rtsp" or not parts.hostname or parts.query or parts.fragment:
                raise ValueError()
            configured_port = parts.port or 8554
            suffix = parts.path.removeprefix("/live/")
            if parts.path != "/live/" + suffix or not suffix:
                raise ValueError()
            if suffix not in ("SESSION_ID", "{session_id}"):
                configured_sid = as_uuid(suffix, "configured session")
                if not validate_template and configured_sid != sid:
                    raise ValueError()
            hostname = parts.hostname if host is None else host
            if not isinstance(hostname, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]+", hostname) or ".." in hostname:
                raise ValueError()
            chosen_port = configured_port if port is None else port
            integer(chosen_port, "port", 1, 65535)
            authority = f"[{hostname}]" if ":" in hostname else hostname
            if parts.username is not None:
                if not parts.username or parts.password is None:
                    raise ValueError()
                # Preserve already URL-encoded credentials, never print them.
                authority = parts.netloc.rsplit("@", 1)[0] + "@" + authority
            return urlunsplit(("rtsp", f"{authority}:{chosen_port}", f"/live/{sid}", "", ""))
        except Exception:
            raise ValueError("Invalid trusted RTSP configuration or session path; values suppressed.") from None

    @classmethod
    def from_env(cls):
        env = values_from_env()
        try:
            return cls(env.get("RTSP_STREAM_URL", cls.__dataclass_fields__["url_template"].default),
                env.get("MEDIA_RTSP_TRANSPORT", "tcp"), float(env.get("LIVE_OPEN_TIMEOUT_SECONDS", "5")),
                float(env.get("LIVE_READ_TIMEOUT_SECONDS", "10")), float(env.get("LIVE_RECONNECT_INITIAL_SECONDS", "1")),
                float(env.get("LIVE_RECONNECT_MAX_SECONDS", "15")), int(env.get("LIVE_MAX_RECONNECT_ATTEMPTS", "8")))
        except Exception:
            raise ValueError("Invalid live stream configuration; values suppressed.") from None


@dataclass(frozen=True)
class LiveSettings:
    sample_interval_seconds: float = 1
    queue_size: int = 3
    duration_seconds: float = 20
    max_accepted_frames: int = 5
    max_candidate_age_seconds: float = 5
    max_consecutive_failures: int = 3

    def __post_init__(self):
        positive(self.sample_interval_seconds, "sample_interval_seconds", 1, 3600)
        integer(self.queue_size, "queue_size", 1, 10)
        positive(self.duration_seconds, "duration_seconds", .01, 86400)
        integer(self.max_accepted_frames, "max_accepted_frames", 1, 10000)
        positive(self.max_candidate_age_seconds, "max_candidate_age_seconds", .01, 10)
        integer(self.max_consecutive_failures, "max_consecutive_failures", 1, 100)

    @classmethod
    def from_env(cls):
        env = values_from_env()
        try:
            # Reuse Task 13 interval if a stricter project policy is configured.
            interval = max(float(env.get("PIPELINE_SAMPLE_INTERVAL_SECONDS", "1")),
                           float(env.get("LIVE_SAMPLE_INTERVAL_SECONDS", "1")))
            return cls(interval, int(env.get("LIVE_QUEUE_SIZE", "3")),
                float(env.get("LIVE_TEST_DURATION_SECONDS", "20")), int(env.get("LIVE_MAX_TEST_FRAMES", "5")),
                float(env.get("LIVE_MAX_CANDIDATE_AGE_SECONDS", "5")), int(env.get("LIVE_MAX_CONSECUTIVE_FAILURES", "3")))
        except Exception:
            raise ValueError("Invalid live runner configuration; values suppressed.") from None

"""HTTP settings only; database/embedding settings retain their existing loaders."""

from dataclasses import dataclass, field
import math
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values

ENV_FILE = Path(__file__).with_name(".env")
AUTH_ENV_FILE = Path(__file__).resolve().parents[2] / "web" / "ai-backend" / ".env"


@dataclass(frozen=True)
class ApiSettings:
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173",
                                    "http://localhost:5174", "http://127.0.0.1:5174")
    jwt_secret: str | None = field(default=None, repr=False)
    refresh_max_days: float = 7.0

    def __post_init__(self):
        if not isinstance(self.host, str) or not self.host.strip():
            raise ValueError("API_HOST must be a hostname or IP address.")
        if isinstance(self.port, bool) or not isinstance(self.port, int) or not 1 <= self.port <= 65535:
            raise ValueError("API_PORT must be an integer from 1 to 65535.")
        if not isinstance(self.cors_origins, tuple):
            raise ValueError("CORS origins must be an explicit tuple of origins.")
        for origin in self.cors_origins:
            parsed = urlsplit(origin)
            if "*" in origin or any(character.isspace() for character in origin) or parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
                raise ValueError("API_CORS_ORIGINS must contain explicit http/https origins without paths or credentials.")
            parsed.port  # Validate any explicit port using urllib's range checks.
        if isinstance(self.refresh_max_days, bool) or not isinstance(self.refresh_max_days, (int, float)) or not math.isfinite(self.refresh_max_days) or not 0 < self.refresh_max_days <= 365:
            raise ValueError("AUTH_MAX_DAYS must be finite, positive and no greater than 365.")
        if self.jwt_secret is not None and (not isinstance(self.jwt_secret, str) or not self.jwt_secret.strip()):
            raise ValueError("JWT_SECRET must be nonempty when configured.")

    @classmethod
    def from_env(cls):
        try:
            values = dotenv_values(ENV_FILE, interpolate=False)
            auth = dotenv_values(AUTH_ENV_FILE, interpolate=False)
            def get(name, default=None):
                return os.environ.get(name, values.get(name, default))
            origins = get("API_CORS_ORIGINS")
            return cls(
                host=get("API_HOST", "127.0.0.1"), port=int(get("API_PORT", "8000")),
                cors_origins=cls().cors_origins if origins is None else tuple(origin.strip() for origin in origins.split(",") if origin.strip()),
                jwt_secret=get("JWT_SECRET", auth.get("JWT_SECRET")) or None,
                refresh_max_days=float(get("AUTH_MAX_DAYS", auth.get("AUTH_MAX_DAYS", "7"))),
            )
        except Exception:
            raise ValueError("Invalid HTTP API configuration; check API_* and authentication settings. Values were suppressed.") from None

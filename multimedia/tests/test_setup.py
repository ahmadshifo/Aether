
import importlib
import sys
from pathlib import Path

from dotenv import dotenv_values


def test_python_version():
    assert sys.version_info[:2] == (3, 13)


def test_required_libraries():
    libraries = [
        "cv2",
        "numpy",
        "PIL",
        "fastapi",
        "uvicorn",
        "openai",
        "mistralai",
        "psycopg",
        "pgvector",
        "sqlalchemy",
        "dotenv",
        "httpx",
    ]

    for library in libraries:
        importlib.import_module(library)


def test_project_folders():
    root = Path(__file__).resolve().parents[1]

    assert (root / "processing").is_dir()
    assert (root / "database").is_dir()
    assert (root / "api").is_dir()


def test_environment_example():
    root = Path(__file__).resolve().parents[1]
    config = dotenv_values(root / "api" / ".env.example")

    required = [
        "OPENAI_API_KEY",
        "MISTRAL_API_KEY",
        "DATABASE_URL",
        "FRAME_STORAGE_PATH",
        "MULTIMEDIA_API_PORT",
        "FRAME_RETENTION_HOURS",
        "RTSP_STREAM_URL",
    ]

    for key in required:
        assert key in config, f"Missing variable: {key}"


def test_private_environment_not_tracked():
    root = Path(__file__).resolve().parents[1]

    assert (root.parent / ".gitignore").is_file()
    assert (root / "api" / ".env.example").is_file()

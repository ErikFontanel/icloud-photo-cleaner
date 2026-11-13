"""Paths for local state, and settings from the repo's .env. State lives under SIFT_HOME (default ~/.sift-mac), outside the repo."""

import os
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def load_env(path: Path = ENV_FILE) -> None:
    """KEY=value lines from .env (see .env.example). Variables already set in the environment win."""
    if path.exists():
        for line in path.read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep and not key.lstrip().startswith("#"):
                os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


load_env()


def home() -> Path:
    path = Path(os.environ.get("SIFT_HOME", Path.home() / ".sift-mac"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def state_db() -> Path:
    return home() / "state.sqlite"


def geonames_dir() -> Path:
    return home() / "geonames"

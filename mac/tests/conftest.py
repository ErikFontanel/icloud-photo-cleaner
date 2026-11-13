import subprocess
import sys
from pathlib import Path

import pytest

TESTS = Path(__file__).parent
MAX_TEST_LIBRARY_ITEMS = 100


def osa(script: str) -> str:
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise RuntimeError(f"osascript failed ({r.returncode}): {r.stderr.strip()}")
    return r.stdout.strip()


@pytest.fixture(autouse=True)
def sift_home(tmp_path, monkeypatch):
    monkeypatch.setenv("SIFT_HOME", str(tmp_path / "sift-home"))
    monkeypatch.delenv("SIFT_HOMES", raising=False)  # tests never see the homes in your .env


@pytest.fixture(scope="session")
def fixture_dir(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("fixtures")
    subprocess.run([sys.executable, str(TESTS / "make_fixtures.py"), str(out)], check=True, capture_output=True)
    return out


@pytest.fixture(scope="session")
def test_library(fixture_dir) -> int:
    """Photos.app open on the Sift Test library, holding the synthetic fixtures. Returns the item count."""
    if subprocess.run(["pgrep", "-x", "Photos"], capture_output=True).returncode:
        pytest.skip("Photos.app is not running; open it on the Sift Test library")
    count = int(osa('tell application "Photos" to count of media items'))
    if count >= MAX_TEST_LIBRARY_ITEMS:
        pytest.fail(f"Refusing to touch the open library: {count} items (limit {MAX_TEST_LIBRARY_ITEMS}). Open Sift Test instead.")
    have = set(osa('tell application "Photos" to get filename of every media item').split(", ")) if count else set()
    missing = [p for p in sorted(fixture_dir.glob("*.jpg")) if p.name not in have]
    if missing:
        files = ", ".join(f'POSIX file "{p}"' for p in missing)
        osa(f'tell application "Photos" to import {{{files}}} skip check duplicates true')
    return int(osa('tell application "Photos" to count of media items'))

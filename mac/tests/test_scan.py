import socket
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import osxphotos
import pytest

from sift_mac import config, offline, state, vision
from sift_mac.scan import scan

TEST_LIBRARY = Path.home() / "Pictures" / "Sift Test.photoslibrary"


def fake(uuid, preview, modified=datetime(2025, 1, 1, tzinfo=UTC)):
    return SimpleNamespace(
        uuid=uuid,
        isphoto=True,
        intrash=False,
        date=datetime(2024, 6, 14, 10, tzinfo=UTC),
        date_modified=modified,
        location=(None, None),
        favorite=False,
        hasadjustments=False,
        screenshot=False,
        labels=[],
        shared=False,
        original_width=1600,
        original_height=1200,
        burst_selected=False,
        burst_key=False,
        burst_default_pick=False,
        path_derivatives=[str(preview)] if preview else [],
        exif_info=SimpleNamespace(camera_make="Canon", camera_model="Canon PowerShot G9 X"),
        keywords=[],
        albums=[],
    )


class Recorder:
    def __init__(self):
        self.calls = []

    def __call__(self, paths):
        self.calls.append(sorted(paths))
        return vision.analyse(paths)


@pytest.fixture
def db():
    return state.connect(config.state_db())


def test_missing_preview_is_skipped(db, fixture_dir):
    counts = scan([fake("a", fixture_dir / "event_0.jpg"), fake("b", None)], db)
    assert counts["analysed"] == 1 and counts["skipped"] == 1
    assert db.execute("select status from assets where uuid='b'").fetchone() == ("skipped",)


def test_incremental(db, fixture_dir):
    first = [fake(f"e{i}", fixture_dir / f"event_{i}.jpg") for i in range(3)]
    scan(first, db)
    added = [fake("b0", fixture_dir / "burst_0.jpg"), fake("b1", fixture_dir / "burst_1.jpg")]
    rec = Recorder()
    counts = scan(first + added, db, analyse=rec)
    assert rec.calls == [sorted([str(fixture_dir / "burst_0.jpg"), str(fixture_dir / "burst_1.jpg")])]
    assert counts["analysed"] == 2 and counts["unchanged"] == 3


def test_changed_and_removed(db, fixture_dir):
    scan([fake("a", fixture_dir / "event_0.jpg"), fake("b", fixture_dir / "event_1.jpg")], db)
    rec = Recorder()
    counts = scan([fake("a", fixture_dir / "event_0.jpg", modified=datetime(2026, 1, 1, tzinfo=UTC))], db, analyse=rec)
    assert rec.calls == [[str(fixture_dir / "event_0.jpg")]]
    assert counts["removed"] == 1
    assert db.execute("select count(*) from assets").fetchone() == (1,)


def test_feature_print_separates_burst_from_other_scenes(fixture_dir):
    r = vision.analyse([str(fixture_dir / n) for n in ("burst_0.jpg", "burst_1.jpg", "event_0.jpg")])
    fp = {Path(k).name: v["fp"] for k, v in r.items()}
    burst, other = vision.distance(fp["burst_0.jpg"], fp["burst_1.jpg"]), vision.distance(fp["burst_0.jpg"], fp["event_0.jpg"])
    print(f"burst distance {burst:.3f}, other scene {other:.3f}")
    assert burst < 0.1 < 0.2 < other


def test_blur_measure(fixture_dir):
    sharp, blurry = vision.blur(str(fixture_dir / "event_0.jpg")), vision.blur(str(fixture_dir / "blurry.jpg"))
    print(f"blur sharp {sharp:.1f}, blurry {blurry:.1f}")
    assert blurry < sharp / 10


@pytest.mark.photos
def test_scan_test_library_offline_and_incremental(db, test_library, monkeypatch):
    for name in ("connect", "connect_ex"):
        monkeypatch.setattr(socket.socket, name, getattr(socket.socket, name))
    monkeypatch.setattr(socket, "getaddrinfo", socket.getaddrinfo)
    offline.enforce()
    first = scan(osxphotos.PhotosDB(str(TEST_LIBRARY)).photos(), db)
    assert first["analysed"] == test_library and first["errors"] == 0
    # Forget two photos; the next scan must analyse exactly those two.
    db.execute("delete from assets where uuid in (select uuid from assets limit 2)")
    rec = Recorder()
    second = scan(osxphotos.PhotosDB(str(TEST_LIBRARY)).photos(), db, analyse=rec)
    assert second["analysed"] == 2 and len(rec.calls[0]) == 2 and second["unchanged"] == test_library - 2


def test_helper_memory_stays_flat(fixture_dir, tmp_path):
    # Regression: without a per-image autoreleasepool, memory grew ~1.6 MB per image and Vision failed after ~16k images.
    import subprocess

    paths = "\n".join(str(fixture_dir / "event_0.jpg") for _ in range(600))
    r = subprocess.run(["/usr/bin/time", "-l", str(vision._ensure_helper())], input=paths, capture_output=True, text=True)
    rss_mb = int(next(l for l in r.stderr.splitlines() if "maximum resident" in l).split()[0]) / 1e6
    errors = sum('"error"' in l for l in r.stdout.splitlines())
    print(f"helper peak RSS {rss_mb:.0f} MB over 600 images, {errors} errors")
    assert errors == 0 and rss_mb < 250


def test_camera_is_stored_and_backfilled(db, fixture_dir):
    scan([fake("a", fixture_dir / "event_0.jpg")], db)
    assert db.execute("select camera from assets where uuid='a'").fetchone() == ("Canon Canon PowerShot G9 X",)
    db.execute("update assets set camera=null")  # a row from before the camera column
    counts = scan([fake("a", fixture_dir / "event_0.jpg")], db)
    assert counts["unchanged"] == 1 and db.execute("select camera from assets").fetchone() == ("Canon Canon PowerShot G9 X",)


def test_a_skipped_photo_is_analysed_once_its_preview_is_local(db, fixture_dir):
    scan([fake("b", None)], db)
    counts = scan([fake("b", fixture_dir / "event_0.jpg")], db)  # same modification date: iCloud only downloaded the preview
    assert counts["analysed"] == 1
    assert db.execute("select status from assets where uuid='b'").fetchone() == ("analysed",)

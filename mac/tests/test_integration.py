"""Write paths against Photos.app open on the Sift Test library. Each test leaves the album as it found it."""

from pathlib import Path

import osxphotos
import pytest

from sift_mac import apply, config, photos_app, state
from sift_mac.scan import scan

pytestmark = pytest.mark.photos
TEST_LIBRARY = Path.home() / "Pictures" / "Sift Test.photoslibrary"


@pytest.fixture
def db(test_library):
    db = state.connect(config.state_db())
    scan(osxphotos.PhotosDB(str(TEST_LIBRARY)).photos(), db)
    return db


@pytest.fixture
def names(db):
    lib = osxphotos.PhotosDB(str(TEST_LIBRARY))
    return {p.original_filename: p.uuid for p in lib.photos()}


def test_no_write_without_apply(db, names):
    before = photos_app.album_members()
    apply.decide(db, "junk", "blurry", accept=[names["event_1.jpg"]], reject=[])
    assert photos_app.album_members() == before


def test_apply_adds_only_new_and_undo_restores(db, names):
    before = photos_app.album_members()
    already = next(iter(before))  # a photo already in the album (put there before this run)
    new = [names["event_1.jpg"], names["event_2.jpg"]]
    apply.decide(db, "junk", "blurry", accept=[already, *new], reject=[])

    r = apply.apply_junk(db)
    print(f"apply: {r}")
    assert r["added"] == 2 and r["already"] == 1
    assert photos_app.album_members() == before | set(new)
    assert {u for (u,) in db.execute("select uuid from journal where run_id=?", (r["run"],))} == set(new)

    u = apply.undo(db, r["run"])
    print(f"undo: {u}")
    assert u["removed"] == 2
    assert photos_app.album_members() == before  # the photo that was already there survives the undo
    with pytest.raises(ValueError, match="already undone"):
        apply.undo(db, r["run"])


def test_apply_refuses_wrong_library(db):
    apply.decide(db, "junk", "blurry", accept=["00000000-0000-0000-0000-000000000000"], reject=[])
    before = photos_app.album_members()
    with pytest.raises(photos_app.WrongLibrary):
        apply.apply_junk(db)
    assert db.execute("select count(*) from runs").fetchone() == (0,)
    assert photos_app.album_members() == before


def test_duplicates_apply_and_undo(db, names):
    before = photos_app.album_members()
    loser = names["burst_1.jpg"]
    apply.decide(db, "dupes", "near", accept=[loser], reject=[names["burst_0.jpg"]])
    r = apply.apply_junk(db, step="dupes")
    assert r["added"] == (0 if loser in before else 1)
    assert loser in photos_app.album_members()
    assert db.execute("select step from runs where id=?", (r["run"],)).fetchone() == ("dupes",)
    apply.undo(db, r["run"])
    assert photos_app.album_members() == before


def test_apply_skips_photos_deleted_since_scan(db, names):
    before = photos_app.album_members()
    real = [names[f"event_{i}.jpg"] for i in range(4)]
    gone = "11111111-1111-1111-1111-111111111111"  # stands in for a photo moved to Recently Deleted
    apply.decide(db, "junk", "blurry", accept=[*real, gone], reject=[])
    r = apply.apply_junk(db)
    print(f"apply: {r}")
    assert r["deleted"] == 1 and r["added"] + r["already"] == 4
    assert apply.pending(db, "junk") == []
    apply.undo(db, r["run"])
    assert photos_app.album_members() == before


def test_keywords_round_trip_and_empty_list(db, names):
    u = names["event_3.jpg"]
    before = photos_app.get_keywords([u])[u]
    photos_app.set_keywords({u: ["sift test", "Lisbon"]})
    assert sorted(photos_app.get_keywords([u])[u]) == ["Lisbon", "sift test"]  # Photos sorts keywords itself
    photos_app.set_keywords({u: []})  # an empty list must not shift other photos' lines
    assert photos_app.get_keywords([u])[u] == []
    photos_app.set_keywords({u: before})


def test_table_apply_makes_event_album_and_undo_removes_it(db, names, monkeypatch):
    from sift_mac import edits

    pile = [names[f"event_{i}.jpg"] for i in range(3)]
    manifest = {"groups": [{"key": pile[0]}], "photos": [{"u": u, "g": 0} for u in pile]}
    monkeypatch.setattr(edits.table, "manifest", lambda db: manifest)
    for leftover in ("Sift test event", "Sift test event renamed"):  # from an earlier run that failed midway
        photos_app.osa(
            'on run argv\ntell application "Photos" to if exists album (item 1 of argv) then delete album (item 1 of argv)\nend run',
            leftover,
        )
    photos_app.set_keywords({pile[1]: []})  # synthetic test photo: start without keywords
    db.execute("insert into eval_runs values ('baseline', 'now', 'q', '[]')")
    edits.name(db, pile[0], "Sift test event")
    edits.tags(db, [pile[1]], add=["sift test"])
    r = edits.apply_all(db)["table"]
    print(f"apply: {r}")
    assert r["added"] == 3 and r["keywords"] == 1 and photos_app.album_members("Sift test event") == set(pile)
    assert "sift test" in photos_app.get_keywords([pile[1]])[pile[1]]
    edits.name(db, pile[0], "Sift test event renamed")
    r2 = edits.apply_all(db)["table"]
    assert photos_app.album_members("Sift test event renamed") == set(pile)
    apply.undo(db, r2["run"])
    apply.undo(db, r["run"])
    assert photos_app.album_members("Sift test event") == set()  # the album this test created is gone again
    assert "sift test" not in photos_app.get_keywords([pile[1]])[pile[1]]


def test_locations_round_trip_and_clear(db, names):
    """Pins cross AppleScript as micro-degrees (locale-proof); clearing must leave no location (undo of a pin)."""
    u = names["event_3.jpg"]
    before = photos_app.get_locations([u])[u]
    print(f"before: {before}")
    photos_app.set_locations({u: (35.0116, 135.7681)})  # Kyoto, east and north: signs and decimals both matter
    got = photos_app.get_locations([u])[u]
    assert got and abs(got[0] - 35.0116) < 1e-4 and abs(got[1] - 135.7681) < 1e-4
    photos_app.set_locations({u: (-33.8688, -70.6693)})  # south and west
    got = photos_app.get_locations([u])[u]
    assert abs(got[0] + 33.8688) < 1e-4 and abs(got[1] + 70.6693) < 1e-4
    photos_app.set_locations({u: None})
    assert photos_app.get_locations([u])[u] is None
    photos_app.set_locations({u: before})


def test_favourites_round_trip(db, names):
    u = names["event_3.jpg"]
    before = photos_app.get_favorites([u])[u]
    photos_app.set_favorites({u: True})
    assert photos_app.get_favorites([u])[u] is True
    photos_app.set_favorites({u: False})
    assert photos_app.get_favorites([u])[u] is False
    photos_app.set_favorites({u: before})

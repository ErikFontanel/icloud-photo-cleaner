import numpy as np
import pytest

from sift_mac import config, dupes, state


@pytest.fixture
def db():
    return state.connect(config.state_db())


def add(db, uuid, date, fp, favorite=0, edited=0, score=0.0, blur=0.9):
    db.execute(
        "insert into assets (uuid, status, date, fp, favorite, edited, score, blur) values (?, 'analysed', ?, ?, ?, ?, ?, ?)",
        (uuid, date, np.asarray(fp, np.float32).tobytes(), favorite, edited, score, blur),
    )


def test_pairs_need_time_window_for_dated_photos(db):
    add(db, "a", "2024-06-14T10:00:00+01:00", [0, 0])
    add(db, "b", "2024-06-14T10:01:00+01:00", [0.1, 0])  # 60 s later, close: pair
    add(db, "c", "2024-06-14T10:05:00+01:00", [0.1, 0])  # 5 min later: no pair, however close
    pairs = {(a, b) for a, b, _ in dupes.candidate_pairs(db)}
    assert pairs == {("a", "b")}


def test_import_hour_pairs_by_distance_only(db, monkeypatch):
    monkeypatch.setattr(dupes, "IMPORT_HOUR_MIN", 3)
    add(db, "i1", "2021-03-26T11:00:00-07:00", [0, 0])
    add(db, "i2", "2021-03-26T11:50:00-07:00", [0.1, 0])  # 50 min apart, but import-dated and close: pair
    add(db, "i3", "2021-03-26T11:55:00-07:00", [0.5, 0])  # above the stricter import distance: no pair
    pairs = {frozenset((a, b)) for a, b, _ in dupes.candidate_pairs(db)}
    assert pairs == {frozenset(("i1", "i2"))}


def test_sets_and_best_shot(db):
    for u, kw in {"a": {}, "b": {"score": 0.9}, "c": {"favorite": 1, "score": -0.5}, "d": {}}.items():
        add(db, u, "2024-01-01T00:00:00+00:00", [0, 0], **kw)
    groups = dupes.sets([("a", "b", 0.1), ("b", "c", 0.2), ("c", "d", 0.5)], threshold=0.3)
    assert sorted(map(sorted, groups)) == [["a", "b", "c"]]
    assert dupes.best_shot(db, ["a", "b", "c"]) == "c"  # favourite beats a higher score
    assert dupes.best_shot(db, ["a", "b"]) == "b"


def test_label_sample_covers_every_bin():
    pairs = [(f"x{i}", f"y{i}", (i % 60) / 100) for i in range(600)]
    sample = dupes.label_sample(pairs)
    bins = {int(d * 10) for _, _, d in sample}
    assert len(sample) == 90 and bins == {0, 1, 2, 3, 4, 5}
    # Topping up keeps existing pairs and only adds what each bin is missing.
    have = sample[:50]
    extra = dupes.label_sample(pairs, have)
    assert len(have) + len(extra) == 90 and not {(a, b) for a, b, _ in have} & {(a, b) for a, b, _ in extra}


def test_junk_photos_are_not_candidates(db):
    from sift_mac import apply

    add(db, "a", "2024-06-14T10:00:00+01:00", [0, 0])
    add(db, "b", "2024-06-14T10:01:00+01:00", [0.1, 0])
    apply.decide(db, "junk", "blurry", accept=["b"], reject=[])
    assert dupes.candidate_pairs(db) == []


def test_review_sets_two_tiers_and_decided_sets_leave(db):
    from sift_mac import apply

    t = "2024-06-14T10:00:{:02d}+01:00"
    add(db, "n1", t.format(0), [0, 0])
    add(db, "n2", t.format(5), [0.05, 0], score=0.9)  # near-identical to n1, better score
    add(db, "p1", t.format(30), [1, 0])
    add(db, "p2", t.format(40), [1.25, 0])  # 0.25 from p1: possible tier
    sets = dupes.review_sets(db)
    assert [s["uuids"] for s in sets["near"]] == [["n1", "n2"]] and sets["near"][0]["best"] == "n2"
    assert [s["uuids"] for s in sets["possible"]] == [["p1", "p2"]]
    apply.decide(db, "dupes", "near", accept=["n1"], reject=["n2"])
    assert dupes.review_sets(db)["near"] == []
    add(db, "n3", t.format(8), [0.08, 0])  # a later scan finds another near copy: the set returns with its decided photos
    assert [s["uuids"] for s in dupes.review_sets(db)["near"]] == [["n1", "n2", "n3"]]


def set_cols(db, uuid, **cols):
    db.execute(f"update assets set {', '.join(f'{k}=?' for k in cols)} where uuid=?", (*cols.values(), uuid))


def test_best_shot_order(db):
    t = "2024-01-01T00:00:00+00:00"
    for u in ("a", "b"):
        add(db, u, t, [0, 0])
        set_cols(db, u, pixels=12_000_000, faces=0, burst_pick=0)
    set_cols(db, "a", score=0.9)
    assert dupes.best_shot(db, ["a", "b"]) == "a"  # aesthetics decides by default
    set_cols(db, "b", faces=2, face_q=0.8)
    set_cols(db, "a", faces=1, face_q=0.3)
    assert dupes.best_shot(db, ["a", "b"]) == "b"  # every photo has faces: face quality wins
    set_cols(db, "b", pixels=2_000_000)
    assert dupes.best_shot(db, ["a", "b"]) == "a"  # b is a small copy: full-size original wins
    set_cols(db, "b", burst_pick=1)
    assert dupes.best_shot(db, ["a", "b"]) == "b"  # Photos' burst pick beats size
    set_cols(db, "a", burst_pick=2)
    assert dupes.best_shot(db, ["a", "b"]) == "a"  # your own burst pick beats Photos'
    set_cols(db, "b", edited=1)
    assert dupes.best_shot(db, ["a", "b"]) == "b"  # edited beats burst pick
    set_cols(db, "a", favorite=1)
    assert dupes.best_shot(db, ["a", "b"]) == "a"  # favourite beats everything

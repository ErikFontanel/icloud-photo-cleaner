import json
import sqlite3
import threading

import numpy as np
import pytest

from sift_mac import table
from sift_mac.table import _clusters, look_names


def test_look_names_pick_the_typical_label():
    db = sqlite3.connect(":memory:")
    db.execute("create table assets (uuid text, labels text)")
    rows = (
        [(f"c{i}", ["Animal", "Mammal", "Cat", "Whiskers"] + (["Window"] if i < 6 else [])) for i in range(10)]
        + [(f"s{i}", ["Sky", "Sunset"] if i < 8 else ["Sky"]) for i in range(10)]
        + [(f"x{i}", ["Sky"] + (["Window"] if i < 4 else [])) for i in range(10)]
        + [("n0", [])]
    )
    db.executemany("insert into assets values (?, ?)", [(u, json.dumps(ls)) for u, ls in rows])
    photos = [{"u": u, "c": {"c": 0, "s": 1, "x": 2, "n": 3}[u[0]]} for u, _ in rows]
    names = look_names(db, photos)
    assert names[0] == "Cat · Window"  # not Mammal or Whiskers; Window is unrelated and strong
    assert names[1] == "Sunset"  # Sky is everywhere, so it says nothing about this cluster
    assert names[3] == "Mixed"  # no labels at all


def test_a_small_library_is_one_cluster():
    cluster, sizes = _clusters(np.random.default_rng(0).random((17, 768), np.float32))  # fewer photos than two clusters need
    assert set(cluster) == {0} and list(sizes) == [17]


@pytest.fixture
def builds(monkeypatch):
    """table.manifest with in-process atlas and group stubs; build threads are joined before teardown. Yields the db."""
    from concurrent.futures import ThreadPoolExecutor
    from types import SimpleNamespace

    from sift_mac import config, state, table

    started = []

    class Thread(threading.Thread):
        def start(self):
            started.append(self)
            super().start()

    monkeypatch.setattr(table, "_state", {"key": None, "manifest": None, "done": 0, "total": 0, "error": None, "build": 0})
    monkeypatch.setattr(table, "threading", SimpleNamespace(Thread=Thread))
    monkeypatch.setattr(table, "ProcessPoolExecutor", ThreadPoolExecutor)
    monkeypatch.setattr(table, "_groups", lambda db, uuids, X, cluster: ([0] * len(uuids), [0] * len(uuids), []))
    db = state.connect(config.state_db())
    yield db, started
    for t in started:
        t.join(10)
        assert not t.is_alive()


def add_photo(db, uuid):
    db.execute(
        "insert into assets (uuid, status, date, preview, favorite, fp) values (?, 'analysed', '2025-02-03T12:05:00+01:00', '/nonexistent.jpg', 0, ?)",
        (uuid, np.zeros(8, np.float32).tobytes()),
    )
    db.commit()


def built(db, started):
    for t in started:
        t.join(10)
    return table.manifest(db)


def test_a_failed_table_build_is_retried_on_the_next_request(builds, monkeypatch):
    db, started = builds
    add_photo(db, "p1")
    fails = [RuntimeError("boom")]

    def clusters(X):
        if fails:
            raise fails.pop()
        return np.zeros(len(X), int), np.array([len(X)])

    monkeypatch.setattr(table, "_clusters", clusters)
    assert table.manifest(db)["building"]
    with pytest.raises(RuntimeError, match="boom"):
        built(db, started)
    assert table.manifest(db)["building"]  # the next request builds again
    assert built(db, started)["photos"][0]["u"] == "p1"


def test_a_stale_table_build_never_overwrites_a_newer_one(builds, monkeypatch):
    db, started = builds
    add_photo(db, "p1")
    gate, first = threading.Event(), []

    def clusters(X):
        if not first:  # the first build (one photo) stalls until the second has finished
            first.append(1)
            gate.wait(10)
            raise RuntimeError("stale")
        return np.zeros(len(X), int), np.array([len(X)])

    monkeypatch.setattr(table, "_clusters", clusters)
    table.manifest(db)
    add_photo(db, "p2")
    table.manifest(db)
    started[1].join(10)
    gate.set()
    m = built(db, started)
    assert {p["u"] for p in m["photos"]} == {"p1", "p2"}

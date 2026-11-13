import json
import sqlite3

import numpy as np

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

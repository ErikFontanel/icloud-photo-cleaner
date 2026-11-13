import numpy as np

from sift_mac import bench, config, state


def test_best_threshold_finds_the_gap():
    d = np.array([0.05, 0.1, 0.15, 0.4, 0.5, 0.6])
    same = np.array([True, True, True, False, False, False])
    r = bench.best_threshold(d, same, lower_is_same=True)
    assert r["f1"] == 1.0 and 0.15 <= r["threshold"] < 0.4
    r = bench.best_threshold(1 - d, same, lower_is_same=False)
    assert r["f1"] == 1.0


def test_dupes_bench_saves_winner(fixture_dir):
    db = state.connect(config.state_db())
    for i in range(30):
        a, b = f"a{i}", f"b{i}"
        for u in (a, b):
            db.execute("insert into assets (uuid, status, preview) values (?, 'analysed', ?)", (u, f"/p/{u}.jpg"))
        same = i < 15
        db.execute("insert into dupe_labels (a, b, dist, same) values (?, ?, ?, ?)", (a, b, 0.1 if same else 0.5, int(same)))

    def fake_embed(paths):  # EmbeddingGemma 2 stand-in that can't separate anything
        return {p: np.array([1.0, 0.0], np.float32) for p in paths}

    r = bench.dupes(db, embed=fake_embed)
    assert r["winner"] == "vision" and r["vision"]["f1"] == 1.0
    assert dict(db.execute("select key, value from settings"))["dupes_detector"] == "vision"

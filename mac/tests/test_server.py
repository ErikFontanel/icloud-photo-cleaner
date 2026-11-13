import json
import threading
import urllib.request
from urllib.error import HTTPError

import pytest

from sift_mac import config, state
from sift_mac.server import make_server


@pytest.fixture
def base(fixture_dir):
    db = state.connect(config.state_db())
    db.execute(
        "insert into assets (uuid, status, date, score, utility, blur, screenshot, favorite, edited, labels, preview) "
        "values ('u1', 'analysed', '2025-02-03T12:05:00+01:00', -0.8, 0, 0.9, 0, 0, 0, '[]', ?)",
        (str(fixture_dir / "blurry.jpg"),),
    )
    db.commit()
    server = make_server(0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def get(url):
    return urllib.request.urlopen(url, timeout=5)


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=5))


def test_junk_api_and_decide(base):
    data = json.load(get(base + "/api/junk"))
    blurry = next(g for g in data["groups"] if g["key"] == "blurry")
    assert [i["uuid"] for i in blurry["items"]] == ["u1"] and data["pending"] == 0
    assert post(base + "/api/decide", {"group": "blurry", "accept": ["u1"], "reject": []}) == {"pending": 1}
    assert json.load(get(base + "/api/junk"))["pending"] == 1


def test_preview_only_for_scanned_photos(base):
    assert get(base + "/preview/u1").headers["Content-Type"] == "image/jpeg"
    with pytest.raises(HTTPError) as e:
        get(base + "/preview/../../etc/passwd")
    assert e.value.code == 404


def test_apply_with_nothing_pending_writes_nothing(base):
    assert post(base + "/api/apply", {}) == {"run": None, "added": 0, "already": 0, "deleted": 0}


def test_both_junk_marks_photos_and_replaces_pair(base, monkeypatch):
    from sift_mac import dupes

    db = state.connect(config.state_db())
    db.execute("insert into dupe_labels (a, b, dist) values ('u1', 'u2', 0.05)")
    db.commit()
    monkeypatch.setattr(dupes, "candidate_pairs", lambda db: [("x", "y", 0.05)])
    r = post(base + "/api/dupes/junk", {"a": "u1", "b": "u2"})
    assert r["pair"]["a"] == "x"  # the junk pair is gone and a replacement was drawn
    assert {u for (u,) in db.execute("select uuid from decisions where step='junk' and choice='accept'")} == {"u1", "u2"}

import json
import threading
import time
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
        "values ('u1', 'analysed', '2025-02-03T12:05:00+01:00', -0.8, 0, 0.05, 0, 0, 0, '[]', ?)",
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


@pytest.fixture(autouse=True)
def no_photos(monkeypatch):
    """Every photos_app function and the rescan subprocess are fakes for the whole test; threads the server starts are
    joined before teardown. Yields the fake photos_app calls: unexpected ones fail the test instead of reaching Photos."""
    import inspect
    from types import SimpleNamespace

    from sift_mac import photos_app, server, table

    calls, started = [], []

    def stub(name):
        def call(*a, **kw):
            calls.append(name)
            raise AssertionError(f"photos_app.{name} reached in a test")

        return call

    for name, fn in inspect.getmembers(photos_app, inspect.isfunction):
        if fn.__module__ == photos_app.__name__:
            monkeypatch.setattr(photos_app, name, stub(name))

    class Thread(threading.Thread):
        def start(self):
            started.append(self)
            super().start()

    monkeypatch.setattr(server, "threading", SimpleNamespace(Thread=Thread))
    monkeypatch.setattr(
        server, "subprocess", SimpleNamespace(run=lambda *a, **kw: SimpleNamespace(stdout="1 photo\n", stderr="", returncode=0))
    )
    monkeypatch.setattr(server, "SCAN", {"running": False, "result": "", "error": ""})
    monkeypatch.setattr(table, "manifest", lambda db: {"groups": [], "photos": []})  # no table build thread
    yield calls
    for t in started:
        t.join(5)
        assert not t.is_alive()


@pytest.fixture
def slow_apply(base, monkeypatch, no_photos):
    """An /api/apply in flight, held inside the Photos write until the test ends. Yields the fake add_to_album calls."""
    from sift_mac import photos_app

    entered, gate, adds = threading.Event(), threading.Event(), []

    def add_to_album(uuids, name=photos_app.TO_DELETE):
        adds.append(list(uuids))
        entered.set()
        gate.wait(10)
        return set()

    monkeypatch.setattr(photos_app, "check_library", lambda uuids, found=None: set(uuids))
    monkeypatch.setattr(photos_app, "album_members", lambda name=photos_app.TO_DELETE: set())
    monkeypatch.setattr(photos_app, "add_to_album", add_to_album)
    post(base + "/api/decide", {"group": "blurry", "accept": ["u1"], "reject": []})
    first = {}
    t = threading.Thread(target=lambda: first.update(post(base + "/api/apply", {})))
    t.start()
    try:
        assert entered.wait(5)
        yield adds
    finally:
        gate.set()
        t.join(10)
    assert not t.is_alive() and first["run"] == 1 and first["added"] == 1 and no_photos == []


@pytest.mark.parametrize("path,body", [("/api/apply", {}), ("/api/table/apply", {}), ("/api/undo", {"run": 1}), ("/api/scan", {})])
def test_a_second_operation_while_one_runs_is_refused(base, slow_apply, no_photos, path, body):
    from sift_mac import server

    with pytest.raises(HTTPError) as e:
        post(base + path, body)
    assert e.value.code == 409
    assert json.load(e.value) == {"error": "An apply to Photos is running, try again when it finishes"}
    assert slow_apply == [["u1"]] and no_photos == []  # sent once, nothing else reached Photos
    assert server.OP["state"] == "applying"


def test_operation_slot_is_free_again_after_an_error(base):
    from sift_mac import server

    with pytest.raises(HTTPError) as e:
        post(base + "/api/undo", {"run": 99})
    assert json.load(e.value) == {"error": "No run 99"} and server.OP["state"] == "idle"
    assert post(base + "/api/apply", {})["run"] is None


@pytest.mark.filterwarnings("ignore::pytest.PytestUnhandledThreadExceptionWarning")
def test_scan_frees_the_slot_when_it_ends_even_on_an_exception(base, monkeypatch):
    from types import SimpleNamespace

    from sift_mac import server

    def run(*a, **kw):
        raise OSError("no python")

    monkeypatch.setattr(server, "subprocess", SimpleNamespace(run=run))
    assert post(base + "/api/scan", {})["error"] == ""  # accepted; the faked scan may already have ended
    for _ in range(250):
        if server.OP["state"] == "idle" and not server.SCAN["running"]:
            break
        time.sleep(0.02)
    assert server.OP["state"] == "idle" and not server.SCAN["running"]
    assert post(base + "/api/scan", {})["error"] == ""  # a new scan may start


def test_a_locked_database_answers_with_json(base, monkeypatch):
    import sqlite3

    from sift_mac import apply

    def locked(*a):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(apply, "decide", locked)
    with pytest.raises(HTTPError) as e:
        post(base + "/api/decide", {"group": "blurry", "accept": ["u1"]})
    assert e.value.code == 409 and json.load(e.value) == {"error": "database is locked"}


def test_static_files_come_from_the_build_only(tmp_path, monkeypatch):
    from sift_mac import server

    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("grid")
    (tmp_path / "table.html").write_text("table")
    (tmp_path / "assets" / "app.js").write_text("js")
    (tmp_path.parent / "secret.js").write_text("no")
    monkeypatch.setattr(server, "WEB", tmp_path)
    assert server.static_file("/").read_text() == "grid"
    assert server.static_file("/table").read_text() == "table"
    assert server.static_file("/assets/app.js").read_text() == "js"
    assert server.static_file("/../secret.js") is None  # outside the build
    assert server.static_file("/assets/missing.js") is None
    assert server.static_file("/api/junk") is None

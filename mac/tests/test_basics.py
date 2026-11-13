import pytest

from sift_mac import config, state
from sift_mac.server import make_server


def test_server_binds_loopback_only():
    server = make_server(0)
    try:
        assert server.server_address[0] == "127.0.0.1"
    finally:
        server.server_close()


def test_state_schema():
    db = state.connect(config.state_db())
    tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
    assert {"assets", "runs", "journal"} <= tables
    assert str(config.state_db()).endswith("sift-home/state.sqlite")


@pytest.mark.photos
def test_test_library_holds_fixtures(test_library, fixture_dir):
    assert test_library == len(list(fixture_dir.glob("*.jpg")))

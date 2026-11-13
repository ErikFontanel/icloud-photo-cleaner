import socket
import threading
import urllib.request

import pytest

from sift_mac import offline
from sift_mac.server import make_server


@pytest.fixture
def guarded(monkeypatch):
    # monkeypatch restores the originals after each test.
    monkeypatch.setattr(socket.socket, "connect", socket.socket.connect)
    monkeypatch.setattr(socket.socket, "connect_ex", socket.socket.connect_ex)
    monkeypatch.setattr(socket, "getaddrinfo", socket.getaddrinfo)
    monkeypatch.delenv("HF_HUB_OFFLINE", raising=False)
    offline.enforce()


def test_blocks_outside_connection(guarded):
    s = socket.socket()
    with pytest.raises(OSError, match="blocked connection to 1.1.1.1:443"):
        s.connect(("1.1.1.1", 443))
    s.close()


def test_blocks_outside_lookup(guarded):
    with pytest.raises(OSError, match="blocked lookup of huggingface.co"):
        socket.getaddrinfo("huggingface.co", 443)


def test_sets_hf_offline(guarded):
    import os

    assert os.environ["HF_HUB_OFFLINE"] == "1"


def test_review_works_offline(guarded):
    server = make_server(0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        port = server.server_address[1]
        body = urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=5).read().decode()
        assert "Sift review" in body
    finally:
        server.shutdown()

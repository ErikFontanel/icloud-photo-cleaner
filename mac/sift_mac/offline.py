"""Runtime network guard: outside `setup`, only loopback connections and lookups are allowed."""

import ipaddress
import os
import socket

_connect = socket.socket.connect
_connect_ex = socket.socket.connect_ex
_getaddrinfo = socket.getaddrinfo


def is_loopback(host) -> bool:
    if host in ("localhost", "", None):
        return True
    try:
        return ipaddress.ip_address(str(host).split("%")[0]).is_loopback
    except ValueError:
        return False


def _check(addr):
    # AF_UNIX addresses are paths (str/bytes), never tuples.
    if isinstance(addr, tuple) and not is_loopback(addr[0]):
        raise OSError(f"sift-mac runs offline: blocked connection to {addr[0]}:{addr[1]}")


def _guarded_connect(self, addr):
    _check(addr)
    return _connect(self, addr)


def _guarded_connect_ex(self, addr):
    _check(addr)
    return _connect_ex(self, addr)


def _guarded_getaddrinfo(host, *args, **kwargs):
    if not is_loopback(host if not isinstance(host, bytes) else host.decode()):
        raise OSError(f"sift-mac runs offline: blocked lookup of {host}")
    return _getaddrinfo(host, *args, **kwargs)


def enforce() -> None:
    """Block non-loopback sockets in this Python process. Subprocesses (osascript, the Swift helper, Ollama) are not covered."""
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    socket.socket.connect = _guarded_connect
    socket.socket.connect_ex = _guarded_connect_ex
    socket.getaddrinfo = _guarded_getaddrinfo

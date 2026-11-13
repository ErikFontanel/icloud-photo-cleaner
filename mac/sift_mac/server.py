"""Review page server. Binds to 127.0.0.1 only. Serves the page, a JSON API and local previews of scanned photos."""

import json
import sqlite3
import subprocess
import sys
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import apply, config, dupes, edits, junk, photos_app, state, table

WEB = Path(__file__).parent / "web"  # built from mac/web by `pnpm --dir mac/web build`
PAGES = {"/": "index.html", "/table": "table.html"}
TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
}


def static_file(path: str) -> Path | None:
    """The built page or asset for a URL path, or None. Only files inside WEB are served."""
    f = (WEB / PAGES.get(path, path.lstrip("/"))).resolve()
    return f if f.is_file() and f.is_relative_to(WEB.resolve()) and f.suffix in TYPES else None


SCAN = {"running": False, "result": "", "error": ""}  # the rescan started from the page
OP = {"state": "idle"}  # the one scan, apply or undo running: idle, scanning, applying or undoing
_op_lock = threading.Lock()
RUNNING = {"scanning": "A scan is running", "applying": "An apply to Photos is running", "undoing": "An undo is running"}


def claim(op: str) -> None:
    """Takes the operation slot without waiting; while it is taken, another scan, apply or undo is refused (HTTP 409)."""
    with _op_lock:
        if OP["state"] != "idle":
            raise RuntimeError(f"{RUNNING[OP['state']]}, try again when it finishes")
        OP["state"] = op


def release() -> None:
    with _op_lock:
        OP["state"] = "idle"


@contextmanager
def operation(op: str):
    claim(op)
    try:
        yield
    finally:
        release()


def _rescan() -> None:
    """`sift-mac scan` in its own process: reads the library Photos uses (never writes), analyses new photos only."""
    try:
        r = subprocess.run([sys.executable, "-c", "from sift_mac.cli import main; main(['scan'])"], capture_output=True, text=True)
        lines = r.stdout.strip().splitlines()
        SCAN.update(result=lines[-1] if lines else "", error=r.stderr.strip().splitlines()[-1] if r.returncode and r.stderr.strip() else "")
    finally:
        SCAN["running"] = False
        release()


def next_label(db) -> dict:
    """The labelling sample is stored, so answers survive restarts. Pairs with a junk photo drop out and are replaced."""
    db.execute("""delete from dupe_labels where exists (select 1 from decisions d
                  where d.step='junk' and d.choice='accept' and d.uuid in (dupe_labels.a, dupe_labels.b))""")
    have = db.execute("select a, b, dist from dupe_labels").fetchall()
    if sum(1 for *_, d in have if d < dupes.LABEL_BINS[-1]) < dupes.LABELS_PER_BIN * (len(dupes.LABEL_BINS) - 1):
        db.executemany("insert into dupe_labels (a, b, dist) values (?, ?, ?)", dupes.label_sample(dupes.candidate_pairs(db), have))
    db.commit()
    total, done = db.execute("select count(*), count(same) from dupe_labels").fetchone()
    row = db.execute("select a, b, dist from dupe_labels where same is null order by rowid limit 1").fetchone()
    return {"pair": dict(zip(("a", "b", "dist"), row)) if row else None, "done": done, "total": total}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, data, code: int = 200) -> None:
        self._send(code, json.dumps(data).encode(), "application/json")

    def _runs(self, db) -> list[dict]:
        rows = db.execute(
            "select r.id, r.step, r.created, r.undone, count(j.uuid) from runs r left join journal j on j.run_id = r.id group by r.id order by r.id desc"
        )
        return [{"id": i, "step": s, "created": c, "undone": u, "writes": n} for i, s, c, u, n in rows]

    def do_GET(self):
        db = state.connect(config.state_db())
        try:
            if (f := static_file(self.path.split("?")[0])) is not None:
                self._send(
                    200, f.read_bytes(), f"{TYPES[f.suffix]}; charset=utf-8" if f.suffix in (".html", ".js", ".css") else TYPES[f.suffix]
                )
            elif self.path.split("?")[0] in PAGES:
                self._send(503, b"The review page is not built. Run: pnpm --dir mac/web build", "text/plain; charset=utf-8")
            elif self.path == "/api/junk":
                self._json(
                    {
                        "groups": junk.candidates(db),
                        "pending": len(apply.pending(db, "junk")),
                        "album": photos_app.TO_DELETE,
                        "runs": [r for r in self._runs(db) if r["step"] == "junk"],
                    }
                )
            elif self.path == "/api/dupes/label":
                self._json(next_label(db))
            elif self.path == "/api/dupes/sets":
                self._json(
                    {
                        **dupes.review_sets(db),
                        "pending": len(apply.pending(db, "dupes")),
                        "album": photos_app.TO_DELETE,
                        "runs": [r for r in self._runs(db) if r["step"] == "dupes"],
                    }
                )
            elif self.path == "/api/table":
                self._json(table.manifest(db))
            elif self.path == "/api/events/piles":
                st = edits.state(db)
                self._json({"piles": edits.piles(db, st), **st})
            elif self.path == "/api/scan":
                self._json(SCAN)
            elif self.path == "/api/table/apply/progress":
                self._json(edits.PROGRESS)
            elif self.path == "/api/table/state":
                self._json(edits.state(db))
            elif self.path.startswith("/api/table/atlas/"):
                key, i = self.path.removeprefix("/api/table/atlas/").removesuffix(".jpg").rsplit("-", 1)
                body = table.atlas(key, int(i))
                self._send(200, body, "image/jpeg") if body else self._send(404, b"not found", "text/plain")
            elif self.path.startswith("/thumb/"):
                uuid, _, size = self.path.removeprefix("/thumb/").partition("?s=")
                body = table.thumb(db, uuid, min(int(size or 512), 2048))
                self._send(200, body, "image/jpeg") if body else self._send(404, b"not found", "text/plain")
            elif self.path.startswith("/preview/"):
                row = db.execute("select preview from assets where uuid=?", (self.path.removeprefix("/preview/"),)).fetchone()
                if not row or not row[0] or not Path(row[0]).exists():
                    self._send(404, b"not found", "text/plain")
                else:
                    self._send(200, Path(row[0]).read_bytes(), "image/jpeg")
            else:
                self._send(404, b"not found", "text/plain")
        except RuntimeError as e:
            self._json({"error": str(e)}, 409)
        finally:
            db.close()

    def do_POST(self):
        db = state.connect(config.state_db())
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or "{}")
            if self.path == "/api/scan":
                claim("scanning")  # _rescan releases it when the scan ends
                SCAN.update(running=True, result="", error="")
                threading.Thread(target=_rescan, daemon=True).start()
                self._json(SCAN)
            elif self.path == "/api/decide":
                step = body.get("step", "junk")
                apply.decide(db, step, body["group"], body.get("accept", []), body.get("reject", []))
                self._json({"pending": len(apply.pending(db, step))})
            elif self.path == "/api/dupes/label":
                db.execute("update dupe_labels set same=? where a=? and b=?", (int(body["same"]), body["a"], body["b"]))
                db.commit()
                self._json(next_label(db))
            elif self.path == "/api/dupes/junk":
                apply.decide(db, "junk", "from-duplicates", accept=[body["a"], body["b"]], reject=[])
                self._json(next_label(db))
            elif self.path == "/api/dupes/unlabel":
                db.execute("update dupe_labels set same=null where rowid=(select max(rowid) from dupe_labels where same is not null)")
                db.commit()
                self._json(next_label(db))
            elif self.path == "/api/table/sync":
                edits.sync(db, body.get("marked", []), body.get("restored", []), body.get("piles", {}))
                self._json({"pending": edits.pending(db)})
            elif self.path == "/api/table/name":
                edits.name(db, body["pile"], body["name"])
                self._json({"pending": edits.pending(db)})
            elif self.path == "/api/table/tags":
                edits.tags(db, body["uuids"], body.get("add", []), body.get("remove", []))
                self._json(edits.state(db))
            elif self.path == "/api/table/album":
                edits.album(db, body["uuids"], body["album"], body.get("remove", False))
                self._json(edits.state(db))
            elif self.path == "/api/events/piles":
                self._json(edits.piles_update(db, body["keys"]))
            elif self.path == "/api/table/place":
                found = edits.set_place(db, body["uuids"], body.get("city", ""), body.get("country", ""))
                self._json({"pending": edits.pending(db), "place": found})  # the place it found, so the page can say which
            elif self.path == "/api/table/place-info":
                self._json(edits.place_info(db, body["uuids"], body.get("pile_uuids", []), body.get("name", "")))
            elif self.path == "/api/table/keep":
                edits.keep(db, body["pile"], body.get("on", True))
                self._json({"pending": edits.pending(db)})
            elif self.path == "/api/table/favorite":
                edits.favorite(db, body["uuids"], body.get("on", True))
                self._json({"pending": edits.pending(db)})
            elif self.path == "/api/table/undo-edit":
                self._json({"undone": edits.undo_edit(db), "pending": edits.pending(db)})
            elif self.path == "/api/table/apply":
                with operation("applying"):
                    self._json({"result": edits.apply_all(db), **edits.state(db)})
            elif self.path == "/api/table/similar":
                self._json({"uuids": table.similar(db, body["uuids"], int(body.get("n", 60)), body.get("exclude", []))})
            elif self.path == "/api/apply":
                with operation("applying"):
                    self._json(apply.apply_junk(db, step=body.get("step", "junk")))
            elif self.path == "/api/undo":
                with operation("undoing"):
                    self._json(apply.undo(db, int(body["run"])))
            else:
                self._send(404, b"not found", "text/plain")
        except (photos_app.WrongLibrary, ValueError, RuntimeError, sqlite3.OperationalError) as e:  # OperationalError: database locked
            self._json({"error": str(e)}, 409)
        finally:
            db.close()


def make_server(port: int = 8765) -> ThreadingHTTPServer:
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)

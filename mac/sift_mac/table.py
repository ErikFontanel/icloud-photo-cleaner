"""Photo table (proof of concept): every photo not yet marked for To Delete, as tiny thumbnails packed into atlases
for one instanced WebGL draw, plus visual clusters and nearest-neighbour lookups on Vision feature prints."""

import hashlib
import io
import json
import math
import sqlite3
import threading
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime

import numpy as np
from PIL import Image
from scipy.cluster.hierarchy import leaves_list, linkage
from scipy.cluster.vq import kmeans2

from . import config, events

TILE = 64  # thumbnail long side in the atlas; the page loads a sharper copy once a photo is drawn large
ATLAS = 2048  # atlas side, so 1024 photos per atlas
PER_ATLAS = (ATLAS // TILE) ** 2
CLUSTER_SIZE = 150  # about this many photos per visual cluster
VERSION = "3"  # bump when the manifest's shape changes, so cached ones are rebuilt

_lock = threading.Lock()
_state = {"key": None, "manifest": None, "done": 0, "total": 0, "error": None, "build": 0}


def _photos(db: sqlite3.Connection):
    """Every analysed photo. Marked ones are included too (the page hides them), so marking never rebuilds the atlases."""
    return db.execute(
        "select uuid, date, preview, favorite, fp from assets where status='analysed' and fp is not null order by date"
    ).fetchall()


def _dir():
    d = config.home() / "table"
    d.mkdir(exist_ok=True)
    return d


def _build_atlas(args) -> list[tuple[int, int]]:
    """One atlas file; returns each tile's (w, h). Runs in a worker process."""
    path, previews = args
    atlas = Image.new("RGB", (ATLAS, ATLAS), (40, 40, 40))
    sizes = []
    for i, p in enumerate(previews):
        try:
            im = Image.open(p)
            im.draft("RGB", (TILE * 2, TILE * 2))
            im = im.convert("RGB")
            im.thumbnail((TILE, TILE))
        except OSError:
            im = Image.new("RGB", (TILE, TILE), (80, 80, 80))
        atlas.paste(im, ((i % (ATLAS // TILE)) * TILE, (i // (ATLAS // TILE)) * TILE))
        sizes.append(im.size)
    atlas.save(path, "JPEG", quality=85)
    return sizes


def _clusters(X: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Visual clusters, numbered so that neighbouring numbers look alike (leaf order of the centroids)."""
    k = max(1, len(X) // CLUSTER_SIZE)
    Xc = X - X.mean(axis=0)
    X = Xc @ np.linalg.svd(Xc[:: max(1, len(Xc) // 5000)], full_matrices=False)[2][:64].T  # 64 PCA dims: same groups, ~50x faster
    centroids, label = kmeans2(X, k, minit="++", seed=0, iter=15)
    rank = np.zeros(k, int)
    if k > 1:  # linkage needs two centroids; a small library is one cluster
        rank[leaves_list(linkage(centroids, "average", metric="cosine"))] = np.arange(k)
    return rank[label], np.bincount(rank[label], minlength=k)


ODD = "Odd ones"  # a cluster no label fits: mostly photos that look like nothing else in the library
BROAD = {"Animal", "Mammal", "Feline", "Felinae", "Whiskers", "Canine", "Line", "Road Other"}  # Cat and Dog say it better


def look_names(db: sqlite3.Connection, photos: list[dict]) -> list[str]:
    """A name per visual cluster from Photos' own scene labels: the label most typical of the cluster (common in it,
    rare elsewhere; never a broad one like Mammal), plus a second unrelated one when strong (Cat · Window)."""
    labels = {u: set(json.loads(ls or "[]")) for u, ls in db.execute("select uuid, labels from assets")}
    by: dict[int, list[str]] = {}
    has: dict[str, set] = {}
    for p in photos:
        by.setdefault(p["c"], []).append(p["u"])
        for lb in labels.get(p["u"], ()):
            has.setdefault(lb, set()).add(p["u"])
    n = len(photos)
    implies = lambda a, b: len(has[a] & has[b]) > 0.85 * len(has[a])  # a photo labelled a is almost always labelled b
    names = [ODD] * (max(by, default=-1) + 1)
    for c, us in by.items():
        share = {lb: k / len(us) for lb, k in Counter(lb for u in us for lb in labels.get(u, ())).items()}
        share = {lb: s for lb, s in share.items() if s >= 0.25 and s * n / len(has[lb]) > 1.5 and lb not in BROAD}
        if not share:
            continue
        score = lambda lb: share[lb] * math.log(share[lb] * n / len(has[lb]))  # noqa: B023 - used in this iteration only
        a = max(share, key=score)
        rest = [b for b in share if b != a and not implies(a, b) and not implies(b, a) and share[b] >= 0.3]
        names[c] = a + (f" · {max(rest, key=score)}" if rest else "")
    # Clusters that got the same name: add the label that sets each apart from the others of that name (Cat · Sofa).
    for name in {x for x in names if x != ODD and names.count(x) > 1}:
        same = [c for c in by if names[c] == name]
        parts = name.split(" · ")
        for c in same:
            others = [u for o in same if o != c for u in by[o]]
            here = Counter(lb for u in by[c] for lb in labels.get(u, ()))
            there = Counter(lb for u in others for lb in labels.get(u, ()))
            gap = {
                lb: k / len(by[c]) - there[lb] / len(others)
                for lb, k in here.items()
                if k >= 0.08 * len(by[c])
                and lb not in BROAD
                and lb not in parts
                and not any(implies(lb, p) or implies(p, lb) for p in parts)
            }
            for lb in sorted(gap, key=gap.get, reverse=True):
                new = f"{parts[0]} · {lb}"  # the head label stays; the tie-breaker replaces a shared second one
                if gap[lb] < 0.05:
                    break  # nothing sets it apart: it keeps the shared name
                if new not in names:
                    names[c] = new
                    break
    return names


def add_distances(db: sqlite3.Connection, photos: list[dict]) -> None:
    """Each photo's feature print distance to its cluster's centre ("d"), so an Odd ones cluster lists its closest matches first."""
    fp = dict(db.execute("select uuid, fp from assets where fp is not null"))
    by: dict[int, list[dict]] = {}
    for p in photos:
        if p["u"] in fp:
            by.setdefault(p["c"], []).append(p)
    for ps in by.values():
        X = np.stack([np.frombuffer(fp[p["u"]], np.float32) for p in ps])
        for p, d in zip(ps, np.linalg.norm(X - X.mean(axis=0), axis=1), strict=True):
            p["d"] = round(float(d), 3)


def _visual_order(X: np.ndarray) -> np.ndarray:
    return leaves_list(linkage(X, "average")) if 2 < len(X) <= 3000 else np.arange(len(X))


def _groups(db: sqlite3.Connection, uuids: list[str], X: np.ndarray, cluster: np.ndarray):
    """Each photo's event pile: the sessions and trips the Events step finds (time gap, GPS, camera, look, keywords).
    A pile's suggested name comes from the detected event most of its photos are in: the model's name, else the rule's
    reason. Import-dated photos have no usable time, so they pile by look. A pile's key is its first photo's uuid."""
    places = events.Places()
    named = {}
    for e in events.detect(db, places):
        if e["reason"]:
            named.update({u: ((e["place"]["city"] + " · " if e["place"] else "") + e["reason"], "event") for u in e["uuids"]})
    for result, members in db.execute("select result, uuids from event_guesses"):
        g = json.loads(result)
        if g["kind"] != "everyday":
            label = g["name"] + (f", {g['place']['city']}" if g.get("place") else "")
            named.update({u: (label, g["kind"]) for u in json.loads(members)})
    index = {u: i for i, u in enumerate(uuids)}
    group, order, meta = np.full(len(uuids), -1), np.zeros(len(uuids), int), []
    rows = events._rows(db, include_marked=True)
    for members in filter(None, ([r[0] for r in g if r[0] in index] for g in events.chain(events.sessions(rows), events.common(rows)))):
        votes = [named[u] for u in members if u in named]
        label, kind = max(set(votes), key=votes.count) if len(votes) * 2 > len(members) else ("", "")
        meta.append({"key": members[0], "label": label, "kind": kind})
        idx = np.array([index[u] for u in members])
        group[idx] = len(meta) - 1
        order[idx[_visual_order(X[idx])]] = np.arange(len(idx))
    for c in np.unique(cluster[group < 0]):
        idx = np.where((group < 0) & (cluster == c))[0]
        meta.append({"key": uuids[idx[0]], "label": f"No reliable date · look {c}", "kind": "undated"})
        group[idx] = len(meta) - 1
        order[idx[_visual_order(X[idx])]] = np.arange(len(idx))
    return group, order, meta


def _set(build: int, **values) -> None:
    with _lock:
        if _state["build"] == build:  # a newer build started meanwhile: this one's results are stale
            _state.update(values)


def _build(rows, key, db_path, build):
    try:
        uuids = [r[0] for r in rows]
        chunks = [rows[i : i + PER_ATLAS] for i in range(0, len(rows), PER_ATLAS)]
        d = _dir()
        sizes = []
        _set(build, total=len(rows))
        with ProcessPoolExecutor() as pool:
            jobs = [(str(d / f"{key}-{i}.jpg"), [r[2] for r in c]) for i, c in enumerate(chunks)]
            for s in pool.map(_build_atlas, jobs):
                sizes += s
                _set(build, done=len(sizes))
        X = np.stack([np.frombuffer(r[4], np.float32) for r in rows])
        cluster, _ = _clusters(X)
        db = sqlite3.connect(db_path)  # this thread's own connection
        group, order, groups = _groups(db, uuids, X, cluster)
        db.close()
        manifest = {
            "key": key,
            "tile": TILE,
            "atlas": ATLAS,
            "atlases": len(chunks),
            "groups": groups,
            "photos": [
                {
                    "u": u,
                    "t": int(datetime.fromisoformat(r[1]).timestamp()),
                    "w": w,
                    "h": h,
                    "c": int(c),
                    "f": r[3],
                    "g": int(g),
                    "o": int(o),
                }
                for u, r, (w, h), c, g, o in zip(uuids, rows, sizes, cluster, group, order)
            ],
        }
        (d / f"{key}.json").write_text(json.dumps(manifest))
        _set(build, manifest=manifest)
    except Exception as e:  # shown on the page instead of a stuck progress bar
        _set(build, error=f"{type(e).__name__}: {e}")


def manifest(db: sqlite3.Connection) -> dict:
    """The table's photos once built; until then {building, done, total}. Rebuilt when the set of photos changes."""
    uuids = [u for (u,) in db.execute("select uuid from assets where status='analysed' and fp is not null order by date")]
    key = hashlib.sha1((VERSION + "".join(uuids)).encode()).hexdigest()[:12]  # same key as from _photos' rows
    with _lock:
        if _state["key"] != key:
            _state.update(key=key, manifest=None, done=0, total=len(uuids), error=None, build=_state["build"] + 1)
            cached = _dir() / f"{key}.json"
            if cached.exists():
                _state["manifest"] = json.loads(cached.read_text())
            else:  # only a rebuild needs the feature prints
                threading.Thread(target=_build, args=(_photos(db), key, config.state_db(), _state["build"]), daemon=True).start()
        if _state["manifest"] and "looks" not in _state["manifest"]:  # named on load: labels can change without a rebuild
            _state["manifest"]["looks"] = look_names(db, _state["manifest"]["photos"])
            add_distances(db, _state["manifest"]["photos"])
        error = _state["error"]
        if error:  # reported once; the next request builds again
            _state.update(key=None, error=None)
    if error:
        raise RuntimeError(error)
    return _state["manifest"] or {"building": True, "done": _state["done"], "total": _state["total"]}


def atlas(key: str, i: int) -> bytes | None:
    p = _dir() / f"{key}-{i}.jpg"
    return p.read_bytes() if p.exists() else None


def thumb(db: sqlite3.Connection, uuid: str, size: int) -> bytes | None:
    row = db.execute("select preview from assets where uuid=?", (uuid,)).fetchone()
    if not row or not row[0]:
        return None
    im = Image.open(row[0])
    im.draft("RGB", (size, size))
    im = im.convert("RGB")
    im.thumbnail((size, size))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82)
    return buf.getvalue()


def similar(db: sqlite3.Connection, uuids: list[str], n: int, exclude: list[str]) -> list[str]:
    """The n photos that look most like the mean of uuids (Vision feature prints), skipping exclude."""
    rows = _photos(db)
    index = {r[0]: i for i, r in enumerate(rows)}
    X = np.stack([np.frombuffer(r[4], np.float32) for r in rows])
    q = X[[index[u] for u in uuids if u in index]].mean(axis=0)
    skip = {index[u] for u in [*uuids, *exclude] if u in index}
    order = np.argsort(np.linalg.norm(X - q, axis=1))
    return [rows[i][0] for i in order if i not in skip][:n]

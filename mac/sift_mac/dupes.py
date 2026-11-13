"""Duplicates step: candidate pairs, labelled sample for the benchmark, duplicate sets and the best shot per set."""

import random
import sqlite3
from collections import Counter
from datetime import datetime

import numpy as np

WINDOW_S = 120  # photos with real dates must be taken within 2 minutes of each other
MAX_DIST = 0.6  # loosest feature print distance considered at all
IMPORT_HOUR_MIN = 500  # an hour with this many photos is an import whose dates were lost
IMPORT_MAX_DIST = 0.3  # import-dated photos have no usable time, so they need a stricter distance
NEAR = 0.15  # precision 1.00 on 90 labelled pairs (2026-11-11): bulk-approve tier
POSSIBLE = 0.35  # precision 0.77, recall 0.82: decide-per-set tier, default keep all
LABEL_BINS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
LABELS_PER_BIN = 15


def load(db: sqlite3.Connection, include_junk: bool = False):
    # Photos marked as junk go to To Delete anyway, so they are never duplicate candidates.
    rows = db.execute(f"""select uuid, date, fp from assets a where status='analysed' and fp is not null
                         {"" if include_junk else "and not exists (select 1 from decisions d where d.uuid=a.uuid and d.step='junk' and d.choice='accept')"}
                         order by date""").fetchall()
    uuids = [u for u, _, _ in rows]
    t = np.array([datetime.fromisoformat(d).timestamp() for _, d, _ in rows])
    X = np.stack([np.frombuffer(f, dtype=np.float32) for _, _, f in rows]) if rows else np.zeros((0, 0), np.float32)
    hours = Counter((t // 3600).astype(int).tolist())
    imported = np.array([hours[int(x // 3600)] >= IMPORT_HOUR_MIN for x in t], dtype=bool)
    return uuids, t, X, imported


def candidate_pairs(db: sqlite3.Connection) -> list[tuple[str, str, float]]:
    """(uuid_a, uuid_b, distance) for every pair worth considering, loosest first filter MAX_DIST."""
    uuids, t, X, imported = load(db)
    pairs = []
    dated = np.where(~imported)[0]
    for k, i in enumerate(dated):
        j = k + 1
        while j < len(dated) and t[dated[j]] - t[i] <= WINDOW_S:
            d = float(np.linalg.norm(X[i] - X[dated[j]]))
            if d < MAX_DIST:
                pairs.append((uuids[i], uuids[dated[j]], d))
            j += 1
    idx = np.where(imported)[0]
    if len(idx):
        B = X[idx]
        sq = (B**2).sum(1)
        for s in range(0, len(idx), 1000):
            D = np.sqrt(np.maximum(sq[s : s + 1000, None] + sq[None, :] - 2 * B[s : s + 1000] @ B.T, 0))
            for a, b in zip(*np.where(D < IMPORT_MAX_DIST)):
                if s + a < b:
                    pairs.append((uuids[idx[s + a]], uuids[idx[b]], float(D[a, b])))
    return pairs


def label_sample(pairs, have=(), seed: int = 7) -> list[tuple[str, str, float]]:
    """Pairs that bring each distance bin up to LABELS_PER_BIN, so the labels cover easy and hard cases alike.

    `have` lists the (a, b, dist) pairs already in the sample; they count towards their bin and are never drawn again.
    """
    rng = random.Random(seed)
    taken = {(a, b) for a, b, _ in have}
    sample = []
    for lo, hi in zip(LABEL_BINS, LABEL_BINS[1:]):
        need = LABELS_PER_BIN - sum(1 for *_, d in have if lo <= d < hi)
        inbin = [p for p in pairs if lo <= p[2] < hi and (p[0], p[1]) not in taken]
        sample += rng.sample(inbin, max(0, min(need, len(inbin))))
    rng.shuffle(sample)
    return sample


def sets(pairs, threshold: float) -> list[list[str]]:
    """Connected groups of photos whose pairwise distance is under the threshold."""
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b, d in pairs:
        if d < threshold:
            parent[find(a)] = find(b)
    groups = {}
    for x in parent:
        groups.setdefault(find(x), []).append(x)
    return [g for g in groups.values() if len(g) > 1]


FULL_SIZE = 2 / 3  # a copy below this share of the set's largest resolution counts as a smaller (forwarded, compressed) copy


def best_shot(db: sqlite3.Connection, uuids: list[str]) -> str:
    """Favourite > edited > burst pick (yours, then Photos') > full-size original > face quality > aesthetics score > sharpest.

    Face quality only counts when every photo in the set has faces.
    """
    rows = db.execute(
        f"""select uuid, favorite, edited, burst_pick, pixels, faces, face_q, score, blur from assets
                          where uuid in ({",".join("?" * len(uuids))})""",
        uuids,
    ).fetchall()
    biggest = max((r[4] or 0) for r in rows)
    all_faces = all(r[5] for r in rows)
    return max(
        rows, key=lambda r: (r[1], r[2], r[3] or 0, (r[4] or 0) >= FULL_SIZE * biggest, (r[6] or 0) if all_faces else 0, r[7], r[8])
    )[0]


def review_sets(db: sqlite3.Connection) -> dict[str, list[dict]]:
    """Undecided duplicate sets in two tiers. A photo sits in at most one set; near-identical sets claim photos first."""
    pairs = candidate_pairs(db)
    near = sets(pairs, NEAR)
    claimed = {u for g in near for u in g}
    possible = sets([p for p in pairs if p[0] not in claimed and p[1] not in claimed], POSSIBLE)
    decided = {u for (u,) in db.execute("select uuid from decisions where step='dupes'")}
    out = {}
    for tier, groups in (("near", near), ("possible", possible)):
        rows = []
        for g in groups:
            if decided & set(g):
                continue
            dates = dict(db.execute(f"select uuid, date from assets where uuid in ({','.join('?' * len(g))})", g))
            g = sorted(g, key=lambda u: dates[u])
            rows.append({"uuids": g, "best": best_shot(db, g), "date": dates[g[0]]})
        out[tier] = sorted(rows, key=lambda r: r["date"])
    return out

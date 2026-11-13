"""Junk step: which photos to suggest, in which group, worst first. A photo appears only in the first group it matches."""

import json
import sqlite3
from collections import Counter

import numpy as np
from scipy.cluster.hierarchy import fcluster, leaves_list, linkage

from .photos_app import TO_DELETE
from .vision import CLASSES

DOCUMENT_LABELS = ("Document", "Printed Page", "Handwriting", "Receipt", "Whiteboard", "Ticket", "Menu", "Paper")
LOW_SCORE = -0.6
BLURRY = 0.62  # sharpness; 2026-11-13 contact sheets: below it shake or motion blur, above it mostly sharp or depth of field
MIN_CLASS_CONFIDENCE = 0.05  # below this a photo goes to "Other"
SECTIONED = {"screenshots", "documents", "utility"}
CLUSTER_SIZE = 15  # target average size of a "similar group" on the review page

GROUPS = [
    ("screenshots", "Screenshots", "screenshot = 1", "score"),
    (
        "documents",
        "Documents & receipts",
        "utility = 1 and exists (select 1 from json_each(a.labels) j where j.value in ({}))".format(",".join("?" * len(DOCUMENT_LABELS))),
        "score",
    ),
    ("utility", "Utility shots", "utility = 1", "score"),  # Vision's isUtility: receipts, screens, notes, parking spots
    ("blurry", "Blurry", f"blur < {BLURRY}", "blur"),
    ("low", "Low quality", f"utility = 0 and score < {LOW_SCORE}", "score"),
]


def section(classes_json: str | None) -> str:
    """The CLASSES category with the highest Vision confidence, or "Other"."""
    scores = json.loads(classes_json or "{}")
    best = max(((max((scores.get(i, 0.0) for i in ids), default=0.0), name) for name, ids in CLASSES.items()))
    return best[1] if best[0] >= MIN_CLASS_CONFIDENCE else "Other"


def similarity_order(db: sqlite3.Connection, items: list[dict]) -> list[dict]:
    """Reorder so similar photos sit together and tag each with a cluster number.

    Uses EmbeddingGemma 2 embeddings (content) when every photo has one, else Vision feature prints (pixels).
    """
    for n, i in enumerate(items):
        i["cluster"] = n
    if len(items) < 3:
        return items
    rows = dict(
        (u, (e, f))
        for u, e, f in db.execute(
            f"select uuid, emb, fp from assets where uuid in ({','.join('?' * len(items))})", [i["uuid"] for i in items]
        )
    )
    if all(rows[i["uuid"]][0] is not None for i in items):
        X, metric = np.stack([np.frombuffer(rows[i["uuid"]][0], dtype=np.float32) for i in items]), "cosine"
    elif all(rows[i["uuid"]][1] is not None for i in items):
        X, metric = np.stack([np.frombuffer(rows[i["uuid"]][1], dtype=np.float32) for i in items]), "euclidean"
    else:
        return items
    Z = linkage(X, method="average", metric=metric)
    labels = fcluster(Z, max(1, len(items) // CLUSTER_SIZE), "maxclust")
    for i, c in zip(items, labels):
        i["cluster"] = int(c)
    return [items[k] for k in leaves_list(Z)]


def candidates(db: sqlite3.Connection) -> list[dict]:
    """Undecided junk suggestions. Favourites are never suggested, nor edited photos except screenshots (often a crop)."""
    taken, groups = set(), []
    for key, label, where, order in GROUPS:
        params = DOCUMENT_LABELS if key == "documents" else ()
        rows = db.execute(
            f"""select uuid, date, score, blur, classes, albums from assets a
                where status = 'analysed' and favorite = 0 and (edited = 0 or screenshot = 1) and ({where})
                and not exists (select 1 from decisions d where d.uuid = a.uuid and d.step = 'junk')
                order by {order} asc""",
            params,
        ).fetchall()
        items = [
            {
                "uuid": u,
                "date": d,
                "score": s,
                "blur": b,
                "section": section(c) if key in SECTIONED else None,
                "albums": [t for t in json.loads(a or "[]") if t != TO_DELETE],
            }
            for u, d, s, b, c, a in rows
            if u not in taken
        ]
        taken.update(i["uuid"] for i in items)
        sizes = Counter(i["section"] for i in items if i["section"])
        # Biggest sections first, so one decision clears the most photos; within a section, similar photos sit together.
        by_section = {}
        for i in items:
            by_section.setdefault(i["section"], []).append(i)
        items = [i for sec in sorted(by_section, key=lambda s: (-sizes[s], s or "")) for i in similarity_order(db, by_section[sec])]
        groups.append({"key": key, "label": label, "items": items, "sections": [{"name": n, "count": c} for n, c in sizes.most_common()]})
    return groups

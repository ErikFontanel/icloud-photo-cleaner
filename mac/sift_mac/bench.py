"""`sift-mac bench dupes`: score Vision feature prints and EmbeddingGemma 2 against your labelled pairs, keep the winner."""

import sqlite3

import numpy as np
from PIL import Image

EG2 = "mlx-community/embeddinggemma-2-8bit"


def best_threshold(scores: np.ndarray, same: np.ndarray, lower_is_same: bool) -> dict:
    """Threshold with the best F1 for calling a pair "same moment", plus precision and recall there."""
    s = scores if lower_is_same else -scores
    best = {"f1": -1.0}
    for t in np.unique(s):
        pred = s <= t
        tp, fp, fn = int((pred & same).sum()), int((pred & ~same).sum()), int((~pred & same).sum())
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * p * r / (p + r) if p + r else 0.0
        if f1 > best["f1"]:
            best = {"f1": f1, "precision": p, "recall": r, "threshold": float(t if lower_is_same else -t)}
    return best


def eg2_embeddings(paths: list[str]) -> dict[str, np.ndarray]:
    import mlx.core as mx
    from mlx_vlm import load

    model, processor = load(EG2)
    out = {}
    for i, p in enumerate(paths, 1):
        inp = processor(images=[Image.open(p).convert("RGB")], return_tensors="np")
        e = model(**{k: mx.array(v) for k, v in inp.items()}).text_embeds[0]
        out[p] = np.array(e, dtype=np.float32)
        print(f"\rEmbeddingGemma 2: {i}/{len(paths)}", end="", flush=True)
    print()
    return out


def dupes(db: sqlite3.Connection, embed=eg2_embeddings) -> dict:
    rows = db.execute(
        """select l.a, l.b, l.dist, l.same, pa.preview, pb.preview from dupe_labels l
           join assets pa on pa.uuid = l.a join assets pb on pb.uuid = l.b where l.same is not null"""
    ).fetchall()
    if len(rows) < 20:
        raise SystemExit(f"Only {len(rows)} labelled pairs; label at least 20 in the Duplicates step first.")
    same = np.array([r[3] == 1 for r in rows])
    vision = best_threshold(np.array([r[2] for r in rows]), same, lower_is_same=True)
    emb = embed(sorted({p for r in rows for p in r[4:6]}))
    cos = np.array([float(emb[r[4]] @ emb[r[5]]) for r in rows])
    eg2 = best_threshold(cos, same, lower_is_same=False)
    # Vision wins ties: it needs no download and runs in the scan already.
    winner = "vision" if vision["f1"] >= eg2["f1"] else "embeddinggemma-2"
    threshold = vision["threshold"] if winner == "vision" else eg2["threshold"]
    db.executemany(
        "insert or replace into settings (key, value) values (?, ?)", [("dupes_detector", winner), ("dupes_threshold", str(threshold))]
    )
    db.commit()
    return {"pairs": len(rows), "same": int(same.sum()), "vision": vision, "embeddinggemma-2": eg2, "winner": winner}

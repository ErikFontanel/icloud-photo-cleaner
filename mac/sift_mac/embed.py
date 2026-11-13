"""`sift-mac embed`: EmbeddingGemma 2 image embeddings for undecided junk photos, so the review can group them by content."""

import sqlite3

import numpy as np
from PIL import Image

from . import junk

MODEL = "mlx-community/embeddinggemma-2-8bit"


def todo(db: sqlite3.Connection) -> list[tuple[str, str]]:
    uuids = [i["uuid"] for g in junk.candidates(db) for i in g["items"]]
    if not uuids:
        return []
    return db.execute(f"select uuid, preview from assets where emb is null and uuid in ({','.join('?' * len(uuids))})", uuids).fetchall()


def run(db: sqlite3.Connection) -> int:
    rows = todo(db)
    if not rows:
        return 0
    import mlx.core as mx
    from mlx_vlm import load

    model, processor = load(MODEL)
    for n, (uuid, preview) in enumerate(rows, 1):
        # One image per call: the processor merges a batch into a single embedding.
        inp = processor(images=[Image.open(preview).convert("RGB")], return_tensors="np")
        e = np.array(model(**{k: mx.array(v) for k, v in inp.items()}).text_embeds[0], dtype=np.float32)
        db.execute("update assets set emb=? where uuid=?", (e.tobytes(), uuid))
        if n % 25 == 0 or n == len(rows):
            db.commit()
            print(f"\rEmbedded {n}/{len(rows)}", end="", flush=True)
    print()
    return len(rows)

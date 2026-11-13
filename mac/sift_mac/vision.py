"""Runs the Swift Vision helper over image paths. Also: blur measure and feature print distance."""

import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HELPER_DIR = Path(__file__).parent.parent / "helper"
HELPER = HELPER_DIR / ".build" / "release" / "sift-vision"


def _ensure_helper() -> Path:
    if not HELPER.exists():
        subprocess.run(["swift", "build", "-c", "release", "--package-path", str(HELPER_DIR)], check=True)
    return HELPER


# Vision classifier identifiers the helper reports scores for; the review groups documents and screenshots by them.
CLASSES = {
    "Receipts": ["receipt", "checkbook"],
    "Tickets": ["ticket"],
    "Cards & IDs": ["credit_card", "gift_card", "passport"],
    "Letters & mail": ["envelope"],
    "Handwritten notes": ["handwriting", "sticky_note"],
    "Whiteboards": ["whiteboard", "flipchart"],
    "Books & print": ["book", "magazine", "newspaper"],
    "Maps": ["map"],
    "Charts & diagrams": ["chart", "diagram"],
    "Calendars": ["calendar"],
    "Screens": ["computer", "computer_monitor", "laptop", "television", "phone", "screenshot"],
    "Signs": ["sign", "street_sign"],
    "Food": ["food"],
    "Documents": ["document"],
}


def analyse(paths: list[str]) -> dict[str, dict]:
    """Vision aesthetics score, isUtility, feature print (float32 array) and CLASSES scores per path."""
    if not paths:
        return {}
    env = {**os.environ, "SIFT_CLASSES": ",".join(i for ids in CLASSES.values() for i in ids)}
    results = {}
    # Paths go in through a file and results stream out, so progress can be printed while Vision works.
    with tempfile.TemporaryFile("w+") as f:
        f.write("\n".join(paths))
        f.seek(0)
        proc = subprocess.Popen([str(_ensure_helper())], stdin=f, stdout=subprocess.PIPE, text=True, env=env)
        for n, line in enumerate(proc.stdout, 1):
            r = json.loads(line)
            if "fp" in r:
                r["fp"] = np.frombuffer(base64.b64decode(r["fp"]), dtype=np.float32 if r.pop("fp_type") == "float32" else np.float64)
            results[r["path"]] = r
            if len(paths) >= 500 and (n % 500 == 0 or n == len(paths)):
                print(f"\rAnalysed {n:,}/{len(paths):,}", end="" if n < len(paths) else "\n", file=sys.stderr, flush=True)
        if proc.wait():
            raise RuntimeError(f"sift-vision helper failed with exit code {proc.returncode}")
    return results


def blur(path: str) -> float:
    """Variance of the Laplacian on a 512 px greyscale copy. Low means blurry."""
    img = Image.open(path).convert("L")
    img.thumbnail((512, 512))
    a = np.asarray(img, dtype=np.float32)
    lap = a[1:-1, :-2] + a[1:-1, 2:] + a[:-2, 1:-1] + a[2:, 1:-1] - 4 * a[1:-1, 1:-1]
    return float(lap.var())


def distance(a: np.ndarray, b: np.ndarray) -> float:
    """Same metric as VNFeaturePrintObservation.computeDistance (Euclidean)."""
    return float(np.linalg.norm(a.astype(np.float64) - b.astype(np.float64)))

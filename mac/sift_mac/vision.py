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
from scipy.ndimage import uniform_filter1d

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


BLUR_MEASURE = "sharpest-tile"  # stored in settings; scan re-measures every photo when it changes


def blur(path: str) -> float:
    """Sharpness 0..1 of the sharpest region of a 512 px greyscale copy; low means blurry. Per region, Crete et al.'s
    re-blur measure: a sharp area loses much of its pixel-to-pixel variation when blurred again, a blurry one hardly
    any, so plain areas are not called blurry. The worse axis counts, which catches motion blur. The sharpest region
    counts, so a sharp subject on a soft background (depth of field) is sharp; shake leaves no region sharp."""
    img = Image.open(path).convert("L")
    img.thumbnail((512, 512))
    a = np.asarray(img, dtype=np.float32)
    total, kept = [], []  # per axis: pixel-to-pixel variation, and the part a re-blur removes
    for axis in (0, 1):
        f = np.abs(np.diff(a, axis=axis))
        b = np.abs(np.diff(uniform_filter1d(a, 11, axis=axis), axis=axis))
        total.append(f[8 : a.shape[0] - 9, 8 : a.shape[1] - 9])
        kept.append(np.maximum(f - b, 0)[8 : a.shape[0] - 9, 8 : a.shape[1] - 9])
    tiles = []  # (detail, sharpness) per region of a 4 x 4 grid
    for rows in np.array_split(np.arange(total[0].shape[0]), 4):
        for cols in np.array_split(np.arange(total[0].shape[1]), 4):
            t = [x[np.ix_(rows, cols)].sum() for x in total]
            k = [x[np.ix_(rows, cols)].sum() for x in kept]
            tiles.append((sum(t), min(k[i] / t[i] if t[i] else 0.0 for i in (0, 1))))
    # Near-empty regions (sky, walls) give a noisy score, so only regions with at least half the median detail count.
    floor = 0.5 * float(np.median([d for d, _ in tiles]))
    return float(max(s for d, s in tiles if d >= floor))


def distance(a: np.ndarray, b: np.ndarray) -> float:
    """Same metric as VNFeaturePrintObservation.computeDistance (Euclidean)."""
    return float(np.linalg.norm(a.astype(np.float64) - b.astype(np.float64)))

"""Incremental scan: diff the library against the state database by UUID and modification date, analyse only what is new or changed."""

import json
import sqlite3
from pathlib import Path

from . import vision

PREVIEW_SUFFIXES = {".jpg", ".jpeg", ".heic"}


def preview_path(photo) -> str | None:
    """Largest local preview Photos already keeps on disk. Never triggers an iCloud download."""
    files = [Path(p) for p in photo.path_derivatives if Path(p).suffix.lower() in PREVIEW_SUFFIXES and Path(p).exists()]
    return str(max(files, key=lambda p: p.stat().st_size)) if files else None


def camera(photo) -> str:
    e = photo.exif_info
    return f"{e.camera_make or ''} {e.camera_model or ''}".strip() if e else ""


def _modified(photo) -> str:
    return (photo.date_modified or photo.date).isoformat()


def scan(photos, db: sqlite3.Connection, analyse=vision.analyse) -> dict[str, int]:
    # Rows analysed before the classifier or face check existed count as 'new', so they get analysed once more.
    # Skipped rows (no local preview) count as 'new' too: iCloud may have downloaded the preview since.
    known = {
        uuid: (mod, "new" if status == "skipped" or (status == "analysed" and (classes is None or faces is None)) else status)
        for uuid, mod, status, classes, faces in db.execute("select uuid, modified, status, classes, faces from assets")
    }
    no_camera = {u for (u,) in db.execute("select uuid from assets where camera is null")}  # rows from before the column
    seen, todo = set(), {}
    counts = {"photos": 0, "unchanged": 0, "analysed": 0, "skipped": 0, "errors": 0, "removed": 0}

    for p in photos:
        # Shared Album and Shared-with-You photos belong to someone else; Photos won't add them to your albums.
        if not p.isphoto or p.intrash or p.shared or getattr(p, "syndicated", False):
            continue
        counts["photos"] += 1
        seen.add(p.uuid)
        mod = _modified(p)
        if known.get(p.uuid, (None, "new"))[0] == mod and known[p.uuid][1] != "new":
            counts["unchanged"] += 1
            # Keywords and albums change without a new modification date, so they are refreshed every scan.
            db.execute("update assets set keywords=?, albums=? where uuid=?", (json.dumps(p.keywords), json.dumps(p.albums), p.uuid))
            if p.uuid in no_camera:
                db.execute("update assets set camera=? where uuid=?", (camera(p), p.uuid))
            continue
        lat, lon = p.location
        preview = preview_path(p)
        db.execute(
            """insert into assets (uuid, modified, status, date, lat, lon, favorite, edited, screenshot, labels, preview, pixels, burst_pick, camera, keywords, albums)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               on conflict(uuid) do update set modified=excluded.modified, status=excluded.status, date=excluded.date,
               lat=excluded.lat, lon=excluded.lon, favorite=excluded.favorite, edited=excluded.edited,
               screenshot=excluded.screenshot, labels=excluded.labels, preview=excluded.preview,
               pixels=excluded.pixels, burst_pick=excluded.burst_pick, camera=excluded.camera,
               keywords=excluded.keywords, albums=excluded.albums""",
            (
                p.uuid,
                mod,
                "new" if preview else "skipped",
                p.date.isoformat(),
                lat,
                lon,
                int(p.favorite),
                int(p.hasadjustments),
                int(p.screenshot),
                json.dumps(p.labels),
                preview,
                (p.original_width or 0) * (p.original_height or 0),
                2 if p.burst_selected else 1 if (p.burst_key or p.burst_default_pick) else 0,
                camera(p),
                json.dumps(p.keywords),
                json.dumps(p.albums),
            ),
        )
        if preview:
            todo[preview] = p.uuid
        else:
            counts["skipped"] += 1

    gone = set(known) - seen
    db.executemany("delete from assets where uuid = ?", [(u,) for u in gone])
    counts["removed"] = len(gone)
    db.commit()  # the review page keeps working while Vision analyses the new photos

    for path, r in analyse(list(todo)).items():
        if "error" in r:
            if not counts["errors"]:
                first_error = r["error"]
            counts["errors"] += 1
            continue
        db.execute(
            "update assets set status='analysed', score=?, utility=?, blur=?, fp=?, classes=?, faces=?, face_q=? where uuid=?",
            (
                r["score"],
                int(r["utility"]),
                vision.blur(path),
                r["fp"].tobytes(),
                json.dumps(r.get("classes", {})),
                r.get("faces", 0),
                r.get("face_q"),
                todo[path],
            ),
        )
        counts["analysed"] += 1
    # A new blur measure makes the stored values incomparable, so every analysed photo is measured again, once.
    if db.execute("select value from settings where key='blur_measure'").fetchone() != (vision.BLUR_MEASURE,):
        old = [(u, p) for u, p in db.execute("select uuid, preview from assets where status='analysed'") if p and Path(p).exists()]
        for n, (u, p) in enumerate(old, 1):
            db.execute("update assets set blur=? where uuid=?", (vision.blur(p), u))
            if n % 500 == 0 or n == len(old):
                print(f"Re-measured blur {n:,}/{len(old):,}", flush=True)
        db.execute("insert or replace into settings (key, value) values ('blur_measure', ?)", (vision.BLUR_MEASURE,))
    db.commit()
    if counts["errors"]:
        print(f"First analysis error: {first_error}")
    return counts

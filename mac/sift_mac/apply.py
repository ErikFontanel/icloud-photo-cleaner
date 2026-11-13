"""Turn approved decisions into Photos writes, journal them as one run, and undo a run."""

import json
import sqlite3
from datetime import UTC, datetime

from . import photos_app


def decide(db: sqlite3.Connection, step: str, grp: str, accept: list[str], reject: list[str]) -> None:
    db.executemany(
        "insert or replace into decisions (uuid, step, grp, choice) values (?, ?, ?, ?)",
        [(u, step, grp, "accept") for u in accept] + [(u, step, grp, "reject") for u in reject],
    )
    db.commit()


def pending(db: sqlite3.Connection, step: str) -> list[str]:
    return [u for (u,) in db.execute("select uuid from decisions where step=? and choice='accept' and run_id is null", (step,))]


def apply_junk(db: sqlite3.Connection, app=photos_app, step: str = "junk") -> dict:
    """Add accepted photos of a step (junk, or duplicates that aren't the kept shot) to the To Delete album.

    Photos already in the album are left out of the journal, so undo never removes them.
    """
    uuids = pending(db, step)
    if not uuids:
        return {"run": None, "added": 0, "already": 0, "deleted": 0}
    found = app.check_library(uuids)
    before = app.album_members()
    new = [u for u in uuids if u in found and u not in before]
    run = db.execute("insert into runs (step, created) values (?, ?)", (step, datetime.now(UTC).isoformat())).lastrowid
    refused = app.add_to_album(new)
    db.executemany(
        "insert into journal (run_id, uuid, field, before, after) values (?, ?, 'album', NULL, ?)",
        [(run, u, app.TO_DELETE) for u in new if u not in refused],
    )
    db.execute(f"update decisions set run_id=? where step=? and uuid in ({','.join('?' * len(uuids))})", (run, step, *uuids))
    db.commit()
    # Photos deleted since the scan are skipped; their decisions still close with this run.
    return {
        "run": run,
        "added": len(new) - len(refused),
        "already": len([u for u in uuids if u in found and u in before]),
        "deleted": len(uuids) - len(found),
        "refused": len(refused),
    }


def undo(db: sqlite3.Connection, run: int, app=photos_app) -> dict:
    row = db.execute("select step, undone from runs where id=?", (run,)).fetchone()
    if not row:
        raise ValueError(f"No run {run}")
    if row[1]:
        raise ValueError(f"Run {run} was already undone on {row[1]}")
    rows = db.execute("select uuid, field, before, after from journal where run_id=?", (run,)).fetchall()
    photos = sorted({u for u, field, _, _ in rows if field in ("album", "album_remove", "keywords", "location", "favorite")})
    if photos:
        app.check_library(photos)  # raises if another library is open
    removed = 0
    for old, new in [(b, a) for _, f, b, a in rows if f == "album_name"]:  # names first, so album rows find their album
        app.rename_album(new, old)
        db.execute("update piles set applied_name=? where applied_name=?", (old, new))
        db.execute("update journal set after=? where field='album' and after=?", (old, new))
    rows = db.execute("select uuid, field, before, after from journal where run_id=?", (run,)).fetchall()
    by_album: dict[str, set[str]] = {}
    for u, field, _, title in rows:
        if field == "album":
            by_album.setdefault(title, set()).add(u)
    for title, uuids in by_album.items():
        removed += app.rebuild_album_without(uuids, title)
    put_back: dict[str, list[str]] = {}
    for u, field, title, _ in rows:
        if field == "album_remove":
            put_back.setdefault(title, []).append(u)
    for title, uuids in put_back.items():  # photos this run took out of an album go back in
        app.add_to_album(sorted(uuids), title)
    keywords = {u: json.loads(before) for u, field, before, _ in rows if field == "keywords"}
    if keywords:
        app.set_keywords(keywords)
        db.executemany("update assets set keywords=? where uuid=?", [(json.dumps(k), u) for u, k in keywords.items()])
    locations = {u: (tuple(json.loads(before)) if before else None) for u, field, before, _ in rows if field == "location"}
    if locations:
        app.set_locations(locations)
    favorites = {u: before == "true" for u, field, before, _ in rows if field == "favorite"}
    if favorites:
        app.set_favorites(favorites)
        db.executemany("update assets set favorite=? where uuid=?", [(int(f), u) for u, f in favorites.items()])
    db.execute("update runs set undone=? where id=?", (datetime.now(UTC).isoformat(), run))
    # Undone photos become undecided again, so they can be reviewed afresh.
    db.execute("delete from decisions where run_id=?", (run,))
    db.commit()
    return {"run": run, "removed": removed}

"""Table edits: To Delete marks, event piles (merges, names, places), keywords, album additions and favourites.

Every edit is saved at once and shared with the Grid review (marks are the same junk decisions). Nothing reaches Photos
until apply_all: a named pile becomes an album of that name, keyword edits are written, album additions are made, the
photos without GPS in a pile with a place get a pin at that city's centre, and Best-of picks become favourites.
"""

import json
import re
import sqlite3
import subprocess
from datetime import UTC, datetime
from difflib import get_close_matches
from pathlib import Path
from urllib.parse import unquote_plus

import numpy as np

from . import apply, evals, events, photos_app, table

MARKS = "select uuid, run_id from decisions where step in ('junk', 'dupes') and choice='accept'"
PILE_TABLES = ("piles", "kept")  # keyed by pile; attach() moves their keys after a rebuild
BEST_MIN, BEST_PER, BEST_MAX = 3, 50, 8  # Best-of: 3 favourites per event, plus 1 per 50 photos, at most 8
_places = None


def places() -> events.Places:
    global _places
    if _places is None:
        _places = events.Places()  # GeoNames takes a second to load; once per server
    return _places


def _clean(word: str) -> str:
    word = " ".join(word.split())  # no tabs or line breaks: the AppleScript bridge uses them as separators
    if not word:
        raise ValueError("Empty name")
    return word


def attach(db: sqlite3.Connection, m: dict | None = None) -> None:
    """Keep your piles after the piles are rebuilt (a rescan can change a pile's key, its first photo).

    Every pile you named or moved photos into keeps a snapshot of its photos. A key no longer built is moved to the
    new pile holding most of its old photos; a key still built gets a fresh snapshot.
    """
    m = m or table.manifest(db)
    if m.get("building"):
        return
    key_of = {p["u"]: m["groups"][p["g"]]["key"] for p in m["photos"]}
    built = set(key_of.values())
    used = {k for (k,) in db.execute("select pile from pile_of union " + " union ".join(f"select pile from {t}" for t in PILE_TABLES))}
    for key in sorted(used):
        if key in built:
            db.execute("delete from pile_members where pile=?", (key,))
            db.executemany("insert into pile_members values (?, ?)", [(key, u) for u, k in key_of.items() if k == key])
            continue
        votes: dict[str, int] = {}
        for (u,) in db.execute("select uuid from pile_members where pile=?", (key,)):
            if u in key_of:
                votes[key_of[u]] = votes.get(key_of[u], 0) + 1
        if not votes:
            continue  # a pile made with N (new-…) lives only in pile_of; nothing to move
        new = max(votes, key=votes.get)
        for t in PILE_TABLES:
            if db.execute(f"select 1 from {t} where pile=?", (new,)).fetchone():
                db.execute(f"delete from {t} where pile=?", (key,))  # the target has its own name or place: that one stays
            else:
                db.execute(f"update {t} set pile=? where pile=?", (new, key))
        db.execute("update pile_of set pile=? where pile=?", (new, key))
        db.execute("delete from pile_members where pile=?", (key,))
    db.commit()


def _base(db: sqlite3.Connection) -> dict[str, tuple[list[str], list[str]]]:
    return {
        u: (json.loads(k or "[]"), [a for a in json.loads(a or "[]") if a != photos_app.TO_DELETE])
        for u, k, a in db.execute("select uuid, keywords, albums from assets")
    }


def _keywords(db: sqlite3.Connection, base) -> dict[str, list[str]]:
    """Each photo's keywords as they will be after apply: the scanned ones plus pending adds, minus pending removes."""
    out = {u: list(k) for u, (k, _) in base.items() if k}
    for u, word, op in db.execute("select uuid, keyword, op from tag_edits"):
        words = out.setdefault(u, [])
        if op == "add" and word not in words:
            words.append(word)
        elif op == "remove" and word in words:
            words.remove(word)
    return {u: w for u, w in out.items() if w}


def state(db: sqlite3.Connection) -> dict:
    attach(db)
    base = _base(db)
    marks = db.execute(MARKS).fetchall()
    tags = _keywords(db, base)
    adds: dict[str, list[str]] = {}
    for u, album in db.execute("select uuid, album from album_adds"):
        adds.setdefault(u, []).append(album)
    names = {p: n for p, n in db.execute("select pile, name from piles")}
    inn, out = _written(db)
    albums = {u: [t for t in a if (u, t) not in out] for u, (_, a) in base.items() if a}
    for u, title in sorted(inn):
        if title != photos_app.TO_DELETE and title not in albums.setdefault(u, []):
            albums[u].append(title)  # written by Sift since the last scan
    albums = {u: a for u, a in albums.items() if a}
    removes: dict[str, list[str]] = {}
    for u, title in db.execute("select uuid, album from album_removes"):
        removes.setdefault(u, []).append(title)
    runs = db.execute(
        "select r.id, r.created, r.undone, count(j.uuid) from runs r left join journal j on j.run_id=r.id "
        "where r.step='table' group by r.id order by r.id desc limit 5"
    ).fetchall()
    return {
        "marked": [u for u, run in marks if run is None],
        "gone": [u for u, run in marks if run is not None],  # already in To Delete in Photos
        "pile_of": dict(db.execute("select uuid, pile from pile_of")),
        "names": names,
        "tags": tags,
        "people": {u: json.loads(p) for u, p in db.execute("select uuid, persons from assets") if p and p != "[]"},  # read-only
        "tag_index": sorted({w for words in tags.values() for w in words}, key=str.lower),
        "albums": albums,
        "album_adds": adds,
        "album_removes": removes,  # taken out of these albums (event albums, Sift's additions); written on Apply
        "album_index": sorted(
            {a for _, a in base.values() for a in a} | {a for v in adds.values() for a in v} | set(names.values()), key=str.lower
        ),
        "kept": [p for (p,) in db.execute("select pile from kept")],
        "undo": (db.execute("select label from edit_log order by id desc limit 1").fetchone() or [None])[0],
        "fav_edits": [u for (u,) in db.execute("select uuid from fav_edits")],
        "pending": pending(db),
        "runs": [{"id": i, "created": c, "undone": d, "writes": n} for i, c, d, n in runs],
    }


def piles(db: sqlite3.Connection, st: dict | None = None, keys=None) -> list[dict]:
    """The event piles as the table shows them (merges, names, marks applied), oldest first, for the Grid's Events step."""
    m = table.manifest(db)
    if m.get("building"):
        raise RuntimeError("The table is still being built; try again in a minute.")
    attach(db, m)
    st = st or state(db)
    groups = {g["key"]: g for g in m["groups"]}
    marked = set(st["marked"]) | set(st["gone"])
    info = _info(db)
    guesses = _guessed_places(db)
    kept, fav_edits = set(st["kept"]), set(st["fav_edits"])
    out: dict[str, dict] = {}
    for ph in m["photos"]:
        if ph["u"] in marked:
            continue
        key = st["pile_of"].get(ph["u"], m["groups"][ph["g"]]["key"])
        g = groups.get(key, {"label": "", "kind": "new"})
        pile = out.setdefault(
            key,
            {
                "key": key,
                "name": st["names"].get(key, ""),
                "label": g["label"],
                "kind": g["kind"],
                "start": ph["t"],
                "end": ph["t"],
                "uuids": [],
            },
        )
        pile["uuids"].append(ph["u"])
        pile["start"], pile["end"] = min(pile["start"], ph["t"]), max(pile["end"], ph["t"])
    if keys is not None:  # just these events (after an edit), not all of them
        out = {k: v for k, v in out.items() if k in set(keys)}
    times = {ph["u"]: ph["t"] for ph in m["photos"]}
    chosen = _chosen(db)
    for p in out.values():
        us = p["uuids"]
        p["spots"] = spots(us, p["name"] or p["label"], info, guesses, times, chosen)
        p["kept"] = p["key"] in kept
        p["favorite"] = [u for u in us if info.get(u, (None, None, 0))[2]]
        p["best"] = best_of(us, info, fav_edits)
    return sorted(out.values(), key=lambda p: (p["kind"] == "undated", p["start"]))


def piles_update(db: sqlite3.Connection, keys: list[str]) -> dict:
    """After an edit: just the events it touched (merged, emptied or changed), and the state for their photos, so the
    page swaps those rows instead of downloading every event again. Keys no longer in use come back in "gone"."""
    st = state(db)
    ps = piles(db, st, keys)
    us = {u for p in ps for u in p["uuids"]}
    pick = lambda d: {u: v for u, v in d.items() if u in us}
    return {
        "piles": ps,
        "gone": sorted(set(keys) - {p["key"] for p in ps}),
        **{k: pick(st[k]) for k in ("tags", "people", "albums", "album_adds", "album_removes")},
        **{k: st[k] for k in ("names", "kept", "fav_edits", "undo", "pending", "tag_index", "album_index")},
    }


def _info(db: sqlite3.Connection) -> dict[str, tuple]:
    """Per photo: lat (None without GPS), lon, favourite, aesthetics score, and whether it's a utility shot or screenshot.
    Pins Sift wrote count as GPS, so a pinned photo isn't pinned again."""
    pinned = {
        u for (u,) in db.execute("select j.uuid from journal j join runs r on r.id=j.run_id where j.field='location' and r.undone is null")
    }
    faved = {
        u for (u,) in db.execute("select j.uuid from journal j join runs r on r.id=j.run_id where j.field='favorite' and r.undone is null")
    }
    return {
        u: (la if la is not None or u not in pinned else 0.0, lo, int(bool(f) or u in faved), sc, bool(ut) or bool(sh))
        for u, la, lo, f, sc, ut, sh in db.execute("select uuid, lat, lon, favorite, score, utility, screenshot from assets")
    }


def _guessed_places(db: sqlite3.Connection) -> dict[str, dict]:
    """The city the event judge named, per photo of each judged event (only cities GeoNames knows are kept)."""
    out = {}
    for result, members in db.execute("select result, uuids from event_guesses"):
        place = json.loads(result).get("place")
        if place:
            out.update({u: place for u in json.loads(members)})
    return out


def _chosen(db: sqlite3.Connection) -> dict[str, dict]:
    return {
        u: {"city": c, "country": cc, "lat": la, "lon": lo, "exact": bool(ex)}
        for u, c, cc, la, lo, ex in db.execute("select uuid, city, country, lat, lon, exact from place_edits")
    }


def spots(uuids: list[str], name: str, info: dict, guesses: dict, times: dict, chosen: dict) -> list[dict]:
    """A pile's photos without GPS, grouped by place: the one you set, else a suggestion. One trip can have several
    (Tokyo, Kyoto, Osaka). Each photo is suggested the city of the GPS photo nearest in time in the same pile; a pile
    without GPS photos gets one suggestion for all (see _pile_place). Photos with no idea at all come last, city None."""
    gps = sorted((times.get(u, 0), u) for u in uuids if u in info and info[u][0] is not None and info[u][1] is not None)
    gt = np.array([t for t, _ in gps])
    city_of: dict[str, dict] = {}
    whole = None
    groups: dict[tuple, dict] = {}
    for u in uuids:
        if info.get(u, (0,))[0] is not None:
            continue
        if u in chosen:
            pl, how = chosen[u], "set"
        elif len(gt):
            j = int(np.clip(np.searchsorted(gt, times.get(u, 0)), 1, len(gt)) - 1)
            if j + 1 < len(gt) and abs(gt[j + 1] - times.get(u, 0)) < abs(gt[j] - times.get(u, 0)):
                j += 1
            v = gps[j][1]
            if v not in city_of:
                city_of[v] = places().nearest(*info[v][:2])
            pl, how = city_of[v], "the GPS photos taken nearest in time"
        else:
            whole = whole if whole is not None else (_pile_place(uuids, name, guesses) or {})
            pl, how = (whole or None), whole.get("from") if whole else None
        exact = (pl["lat"], pl["lon"]) if pl and pl.get("exact") else None  # typed coordinates: a group of their own
        key = (pl["city"], pl["country"], how == "set", exact) if pl else (None, None, False, None)
        g = groups.setdefault(
            key,
            {
                "city": key[0],
                "country": key[1],
                "set": key[2],
                "from": how,
                "exact": bool(exact),
                "lat": pl and pl["lat"],
                "lon": pl and pl["lon"],
                "uuids": [],
            },
        )
        g["uuids"].append(u)
    return sorted(groups.values(), key=lambda g: (g["city"] is None, times.get(g["uuids"][0], 0)))


def _pile_place(uuids: list[str], name: str, guesses: dict) -> dict | None:
    """For a pile without GPS photos: the city the event judge named; else a city of 15,000+ people in its name."""
    votes = [guesses[u]["city"] for u in uuids if u in guesses]
    if votes:
        city = max(set(votes), key=votes.count)
        return {**next(guesses[u] for u in uuids if guesses.get(u, {}).get("city") == city), "from": "the event judge"}
    words = [w.strip(",.()") for w in name.split()]
    for n in (3, 2, 1):  # longest names first: "Den Haag" before "Haag"
        for i in range(len(words) - n + 1):
            phrase = " ".join(words[i : i + n])
            if phrase[:1].isupper():
                hit = places().find(phrase, min_population=15000)
                if hit:
                    return {**hit, "from": "the event name"}
    return None


def best_of(uuids: list[str], info: dict, chosen: set[str] = frozenset()) -> list[str]:
    """Best-of suggestions: the top aesthetics scores, so the pile has BEST_MIN favourites plus one per BEST_PER photos
    (at most BEST_MAX). Favourites it already has, and ones you picked, count; utility shots and screenshots never do.
    Junk and duplicate losers are not in the pile at all."""
    want = min(BEST_MAX, BEST_MIN + len(uuids) // BEST_PER, len(uuids))
    have = sum(1 for u in uuids if u in chosen or info.get(u, (0, 0, 0))[2])
    pool = [u for u in uuids if u in info and not info[u][2] and u not in chosen and not info[u][4] and info[u][3] is not None]
    return sorted(pool, key=lambda u: -info[u][3])[: max(0, want - have)]


# ---- undo of saved edits (not of Apply: that is apply.undo of a run) ----
UNDO_KEEP = 50
LOGGED = {
    "decisions": "uuid",
    "pile_of": "uuid",
    "piles": "pile",
    "tag_edits": "uuid",
    "album_adds": "uuid",
    "place_edits": "uuid",
    "kept": "pile",
    "fav_edits": "uuid",
    "album_removes": "uuid",
}  # table -> the column an edit is keyed by


def _rows_of(db, table: str, keys: list) -> list:
    col, out = LOGGED[table], []
    for i in range(0, len(keys), 500):
        part = keys[i : i + 500]
        out += db.execute(f"select * from {table} where {col} in ({','.join('?' * len(part))})", part).fetchall()
    return out


def _log(db: sqlite3.Connection, label: str, **keys) -> None:
    """Remember the rows an edit is about to change, so undo_edit can put them back. Call it right before the writes."""
    snaps = [
        {"table": t, "keys": list(dict.fromkeys(ks)), "rows": _rows_of(db, t, list(dict.fromkeys(ks)))} for t, ks in keys.items() if ks
    ]
    if snaps:
        db.execute("insert into edit_log (label, snaps) values (?, ?)", (label, json.dumps(snaps)))
        db.execute("delete from edit_log where id <= (select max(id) from edit_log) - ?", (UNDO_KEEP,))


def undo_edit(db: sqlite3.Connection) -> str:
    """Undo the last saved edit (a place, merge, name, tag, album, delete mark, keep or favourite). Returns its label."""
    row = db.execute("select id, label, snaps from edit_log order by id desc limit 1").fetchone()
    if not row:
        raise ValueError("Nothing to undo.")
    for s in json.loads(row[2]):
        t, col, keys = s["table"], LOGGED[s["table"]], s["keys"]
        for i in range(0, len(keys), 500):
            part = keys[i : i + 500]
            db.execute(f"delete from {t} where {col} in ({','.join('?' * len(part))})", part)
        if s["rows"]:
            db.executemany(f"insert into {t} values ({','.join('?' * len(s['rows'][0]))})", s["rows"])
    db.execute("delete from edit_log where id=?", (row[0],))
    db.commit()
    attach(db)
    return row[1]


def sync(db: sqlite3.Connection, marked=(), restored=(), piles=None) -> None:
    """Save the table's marks and pile moves. Marks are junk decisions, so the Grid review sees them too."""
    label = (
        f"Delete {len(marked)} photo{'s' * (len(marked) != 1)}"
        if marked
        else f"Restore {len(restored)} photo{'s' * (len(restored) != 1)}"
        if restored
        else f"Move {len(piles or {})} photo{'s' * (len(piles or {}) != 1)} to another event"
    )
    _log(db, label, decisions=[*marked, *restored], pile_of=list(piles or {}))
    already = {u for u, _ in db.execute(MARKS)}
    db.executemany(
        "insert or replace into decisions (uuid, step, grp, choice) values (?, 'junk', 'table', 'accept')",
        [(u,) for u in marked if u not in already],
    )
    db.executemany(
        "delete from decisions where uuid=? and step in ('junk', 'dupes') and choice='accept' and run_id is null", [(u,) for u in restored]
    )
    db.executemany("insert or replace into pile_of (uuid, pile) values (?, ?)", list((piles or {}).items()))
    db.commit()
    if piles:
        attach(db)


def name(db: sqlite3.Connection, pile: str, new: str) -> None:
    new = _clean(new)
    _log(db, f"Name an event {new!r}", piles=[pile])
    db.execute("insert into piles (pile, name) values (?, ?) on conflict(pile) do update set name=excluded.name", (pile, new))
    db.commit()
    attach(db)  # snapshot its photos now, before any rescan


def tags(db: sqlite3.Connection, uuids: list[str], add=(), remove=()) -> None:
    """Save what was asked, whatever the last scan says: the scan may be stale, and apply_all compares with the
    keywords Photos has at that moment, so an add of a keyword already there writes nothing."""
    _log(db, f"Tag {len(uuids)} photo{'s' * (len(uuids) != 1)}", tag_edits=uuids)
    db.executemany("insert or replace into tag_edits values (?, ?, 'add')", [(u, w) for u in uuids for w in map(_clean, add)])
    db.executemany("insert or replace into tag_edits values (?, ?, 'remove')", [(u, w) for u in uuids for w in map(_clean, remove)])
    db.commit()


def _written(db: sqlite3.Connection) -> tuple[set, set]:
    """(photo, album) pairs Sift put in an album and still has there, and the ones Sift took out, from the journal of
    runs not undone, in order (a later run can put back what an earlier one took out)."""
    inn, out = set(), set()
    for u, field, title in db.execute(
        "select j.uuid, j.field, coalesce(j.after, j.before) from journal j join runs r on r.id=j.run_id "
        "where j.field in ('album', 'album_remove') and r.undone is null order by j.run_id, j.rowid"
    ):
        if field == "album":
            inn.add((u, title))
            out.discard((u, title))
        else:
            inn.discard((u, title))
            out.add((u, title))
    return inn, out


def album(db: sqlite3.Connection, uuids: list[str], title: str, remove: bool = False) -> None:
    """Put photos in an album, or take them out. Taking out works for additions not applied yet, for event albums
    (an album named after a pile) and for albums Sift added the photo to; your own Photos albums are left alone,
    because Photos can only take a photo out by rebuilding the album (losing its folder and order)."""
    title = _clean(title)
    _log(
        db,
        f"{'Take' if remove else 'Put'} {len(uuids)} photo{'s' * (len(uuids) != 1)} {'out of' if remove else 'in'} {title!r}",
        album_adds=uuids,
        album_removes=uuids,
    )
    if remove:
        db.executemany("delete from album_adds where uuid=? and album=?", [(u, title) for u in uuids])
        events_ = {n for (n,) in db.execute("select name from piles")}
        inn, _ = _written(db)
        db.executemany(
            "insert or ignore into album_removes values (?, ?)", [(u, title) for u in uuids if title in events_ or (u, title) in inn]
        )
    else:
        db.executemany("delete from album_removes where uuid=? and album=?", [(u, title) for u in uuids])
        base = _base(db)
        db.executemany(
            "insert or ignore into album_adds values (?, ?)", [(u, title) for u in uuids if title not in base.get(u, ([], []))[1]]
        )
    db.commit()


# Decimal degrees: "35.0116, 135.7681", "35.0116N 135.7681E", "S 33.87, W 70.67"; degrees-minutes-seconds:
# 54°51'11.9"N 3°55'40.2"W; map links (URL-encoded or not) with Google's exact pin !3d..!4d.., q=/ll=lat,lon or @lat,lon.
_NUM = r"([-+]?\d{1,3}(?:\.\d+)?)\s*°?\s*([NSEW])?"
_COORDS = re.compile(rf"^\s*([NS])?\s*{_NUM}\s*[,; ]\s*([EW])?\s*{_NUM}\s*$", re.I)
_DMS = r"(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(?:(\d{1,2}(?:\.\d+)?)\s*[\"″]?)?\s*([NSEW])"
_DMS2 = re.compile(rf"{_DMS}[\s,;+]*{_DMS}", re.I)
_LINKS = [
    re.compile(r"!3d([-+]?\d{1,3}\.\d+)!4d([-+]?\d{1,3}\.\d+)"),  # Google: the pin itself
    re.compile(r"[?&](?:q|ll|sll|center)=([-+]?\d{1,3}\.\d+),\s*([-+]?\d{1,3}\.\d+)"),
    re.compile(r"@([-+]?\d{1,3}\.\d+),([-+]?\d{1,3}\.\d+)"),
]  # Google: the map's centre, near the pin


def coordinates(text: str) -> tuple[float, float] | None:
    """Latitude and longitude typed or pasted as text, or None when it isn't coordinates."""
    text = unquote_plus(text)
    m = _DMS2.search(text)
    if m:
        deg = lambda d, mi, se, h: (-1 if h.upper() in "SW" else 1) * (int(d) + int(mi) / 60 + float(se or 0) / 3600)
        if m[4].upper() not in "NS" or m[8].upper() not in "EW":
            raise ValueError("Write latitude first, then longitude: e.g. 54°51'11.9\"N 3°55'40.2\"W.")
        lat, lon = round(deg(*m.groups()[:4]), 6), round(deg(*m.groups()[4:]), 6)
    elif any(r.search(text) for r in _LINKS):
        m = next(r.search(text) for r in _LINKS if r.search(text))
        lat, lon = float(m[1]), float(m[2])
    else:
        m = _COORDS.match(text)
        if not m:
            return None
        lat, lon = float(m[2]), float(m[5])
        ns, ew = (m[1] or m[3] or "").upper(), (m[4] or m[6] or "").upper()
        if ns in ("E", "W") or ew in ("N", "S"):
            raise ValueError("Write latitude first, then longitude: e.g. 35.0116N, 135.7681E.")
        lat, lon = -abs(lat) if ns == "S" else lat, -abs(lon) if ew == "W" else lon
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError(f"{lat}, {lon} isn't on Earth: latitude is -90 to 90, longitude -180 to 180.")
    return lat, lon


HELPER = Path(__file__).parent.parent / "helper"


def apple_maps(text: str, cc: str = "") -> dict | None:
    """A city, venue, business or address found with Apple Maps (MapKit), in country cc when given.
    Only the typed text is sent to Apple, and only when you save a place. None when Apple has nothing or can't be reached.
    Apple reads "Autodromo Monza Italy" best: no commas, the country written out. When it still answers with
    just the town, the search is tried once more without the country."""
    exe = HELPER / ".build" / "release" / "sift-places"
    if not exe.exists():
        subprocess.run(
            ["swift", "build", "-c", "release", "--product", "sift-places", "--package-path", str(HELPER)], check=True, capture_output=True
        )
    words = " ".join(text.replace(",", " ").split())
    country = places().country_names.get(cc, "")

    def search(q: str) -> list[dict]:
        try:
            r = subprocess.run([str(exe), q], capture_output=True, text=True, timeout=10)
            return json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else []
        except (subprocess.TimeoutExpired, json.JSONDecodeError):
            return []

    town_only = lambda r: events.fold(r["name"]) == events.fold(r["locality"] or r["name"])
    in_country = lambda rs: [r for r in rs if not cc or r["country"] == cc]
    found = in_country(search(f"{words} {country}".strip()))
    if found and town_only(found[0]) and events.fold(found[0]["name"]) != events.fold(words) and country:
        found = in_country(search(words)) or found  # "Autodromo Monza IT" answered with just Monza
    if not found:
        return None
    # The place named exactly as typed beats Apple's first answer, which can be a business named after it
    r = next((r for r in found if events.fold(r["name"]) == events.fold(words)), found[0])
    label = r["name"] if not r["locality"] or events.fold(r["locality"]) in events.fold(r["name"]) else f"{r['name']}, {r['locality']}"
    return {"city": label, "country": r["country"], "lat": r["lat"], "lon": r["lon"]}


def _town_in(text: str, cc: str = "") -> dict | None:
    """A town named inside a longer name, with a small typo, or at the start of a venue's name, for places GeoNames
    lists no venue for: "Circuit Spa-Francochamps" finds Francorchamps (and Spa), "Nürburgring" Nürburg. The longest
    name wins, as the most specific."""
    words = [w for w in re.split(r"[\s\-–,/()]+", text) if w]
    found = []
    for n in range(len(words), 0, -1):
        for i in range(len(words) - n + 1):
            phrase = " ".join(words[i : i + n])
            hit = places().find(phrase, cc)
            key = events.fold(phrase)
            if not hit and len(key) >= 6:  # a typo: one close name, same first letter
                near = get_close_matches(key, places().by_initial.get(key[0], []), n=1, cutoff=0.85)
                hit = near and places().find(near[0], cc)
            if not hit and n == 1 and len(key) >= 7:  # a venue named after its town: Nürburgring -> Nürburg
                stem = next((key[:k] for k in range(len(key) - 1, 4, -1) if key[:k] in places().by_name), None)
                hit = stem and places().find(stem, cc)
            if hit:
                found.append(hit)
    return max(found, key=lambda h: len(h["city"]), default=None)


def set_place(db: sqlite3.Connection, uuids: list[str], city: str = "", country: str = "") -> dict | None:
    """Confirm where photos were taken: a city GeoNames knows ("Lisbon" or "Lisbon, PT"), which pins its centre, or
    exact coordinates ("35.0116, 135.7681" or a map link), named after the nearest city. An empty city clears it.
    Photos with GPS are skipped later, in plan(): a pin never replaces a real location."""
    label = f"Place of {len(uuids)} photo{'s' * (len(uuids) != 1)}"
    if not city.strip():
        _log(db, label, place_edits=uuids)
        db.executemany("delete from place_edits where uuid=?", [(u,) for u in uuids])
        db.commit()
        return None
    ll = coordinates(city)
    if ll:
        near = places().nearest(*ll)
        _log(db, label, place_edits=uuids)
        db.executemany(
            "insert or replace into place_edits values (?, ?, ?, ?, ?, 1)",
            [(u, near["city"], near["country"], ll[0], ll[1]) for u in uuids],
        )
        db.commit()
        return {**near, "lat": ll[0], "lon": ll[1]}
    if "," in city and not country:
        city, country = (x.strip() for x in city.rsplit(",", 1))
    # "ES", "ESP" or "Spain"; a country it doesn't know (like "SP") or one that doesn't match falls back to the name alone
    cc = places().countries.get(country.strip().lower(), "")
    # Apple Maps first: it knows venues and spellings GeoNames doesn't. GeoNames when Apple has nothing or is offline.
    # A country you named is never swapped for another one with a same-named town.
    hit = apple_maps(city, cc) or places().find(city, cc) or _town_in(city, cc)
    if not hit:
        raise ValueError(f"Apple Maps and GeoNames don't know {city!r}. Try another spelling, or paste coordinates or a map link.")
    _log(db, label, place_edits=uuids)
    db.executemany(
        "insert or replace into place_edits values (?, ?, ?, ?, ?, 0)",
        [(u, hit["city"], hit["country"], hit["lat"], hit["lon"]) for u in uuids],
    )
    db.commit()
    return hit


def place_info(db: sqlite3.Connection, uuids: list[str], pile_uuids: list[str], name: str = "") -> dict:
    """For the table's inspector: the selected photos without GPS, grouped by place (set or suggested). Suggestions
    look at the whole pile, since the GPS photo nearest in time may not be selected."""
    m = table.manifest(db)
    sel = set(uuids)
    out = []
    for g in spots(
        list(dict.fromkeys([*pile_uuids, *uuids])),
        name,
        _info(db),
        _guessed_places(db),
        {ph["u"]: ph["t"] for ph in m.get("photos", [])},
        _chosen(db),
    ):
        us = [u for u in g["uuids"] if u in sel]
        if us:
            out.append({**g, "uuids": us})
    return {"spots": out}


def keep(db: sqlite3.Connection, pile: str, on: bool = True) -> None:
    _log(db, "Keep an event" if on else "Unkeep an event", kept=[pile])
    db.execute("insert or ignore into kept values (?)" if on else "delete from kept where pile=?", (pile,))
    db.commit()
    if on:
        attach(db)


def favorite(db: sqlite3.Connection, uuids: list[str], on: bool = True) -> None:
    _log(db, f"{'Favourite' if on else 'Unfavourite'} {len(uuids)} photo{'s' * (len(uuids) != 1)}", fav_edits=uuids)
    db.executemany("insert or ignore into fav_edits values (?)" if on else "delete from fav_edits where uuid=?", [(u,) for u in uuids])
    db.commit()


def plan(db: sqlite3.Connection, trust_scan: bool = True) -> dict:
    """What apply_all would write: album renames, album additions per album, keyword changes per photo.
    trust_scan=False ignores album memberships from the last scan (they may be stale); apply then asks Photos itself."""
    m = table.manifest(db)
    if m.get("building"):
        raise RuntimeError("The table is still being built; try again in a minute.")
    attach(db, m)
    pile_of = {p["u"]: m["groups"][p["g"]]["key"] for p in m["photos"]}
    pile_of.update(dict(db.execute("select uuid, pile from pile_of")))
    marked = {u for u, _ in db.execute(MARKS)}
    members: dict[str, list[str]] = {}
    for u, pile in pile_of.items():
        if u not in marked:
            members.setdefault(pile, []).append(u)
    base = _base(db)
    written, taken = _written(db)
    has = lambda u, a: (u, a) in written or (trust_scan and a in base.get(u, ([], []))[1] and (u, a) not in taken)
    removes = set(db.execute("select uuid, album from album_removes"))
    albums: dict[str, set[str]] = {}
    renames = []
    for pile, title, applied in db.execute("select pile, name, applied_name from piles"):
        if applied and applied != title:
            renames.append((pile, applied, title))
        albums.setdefault(title, set()).update(
            u for u in members.get(pile, []) if not has(u, title) and not has(u, applied) and (u, title) not in removes
        )
    for u, title in db.execute("select uuid, album from album_adds"):
        if not has(u, title) and u not in marked and (u, title) not in removes:
            albums.setdefault(title, set()).add(u)
    removals: dict[str, set[str]] = {}  # in the album now (as far as Sift knows), taken out in Sift
    for u, title in removes:
        if (u, title) in written or (title in base.get(u, ([], []))[1] and (u, title) not in taken):
            removals.setdefault(title, set()).add(u)
    keywords: dict[str, tuple[list[str], list[str]]] = {}
    for u, word, op in db.execute("select uuid, keyword, op from tag_edits"):
        keywords.setdefault(u, ([], []))[0 if op == "add" else 1].append(word)
    info = _info(db)
    locations = {
        u: (lat, lon)
        for u, lat, lon in db.execute("select uuid, lat, lon from place_edits")
        if u not in marked and info.get(u, (0,))[0] is None
    }
    favorites = sorted(u for (u,) in db.execute("select uuid from fav_edits") if u not in marked and not info.get(u, (0, 0, 1))[2])
    return {
        "renames": renames,
        "albums": {a: sorted(us) for a, us in albums.items() if us},
        "keywords": keywords,
        "locations": locations,
        "favorites": favorites,
        "removals": {a: sorted(us) for a, us in removals.items()},
    }


def pending(db: sqlite3.Connection) -> dict:
    try:
        p = plan(db)
    except RuntimeError:
        p = {"renames": [], "albums": {}, "keywords": {}, "locations": {}, "favorites": [], "removals": {}}
    return {
        "delete": len(apply.pending(db, "junk")) + len(apply.pending(db, "dupes")),
        "renames": len(p["renames"]),
        "albums": len(p["albums"]),
        "album_photos": sum(map(len, p["albums"].values())),
        "keywords": len(p["keywords"]),
        "locations": len(p["locations"]),
        "favorites": len(p["favorites"]),
        "album_removals": sum(map(len, p["removals"].values())),
    }


PROGRESS = {"step": "", "done": 0, "total": 0}  # the running apply, polled by the page for its progress bar


def apply_all(db: sqlite3.Connection, app=photos_app) -> dict:
    """Write everything pending: To Delete marks (as the junk and duplicates steps do), then album renames, album
    additions, keyword changes, location pins and favourites as one 'table' run that apply.undo reverses."""
    PROGRESS.update(step="To Delete", done=0, total=0)
    try:
        return _apply_all(db, app)
    finally:
        PROGRESS.update(step="", done=0, total=0)


def _apply_all(db: sqlite3.Connection, app) -> dict:
    out = {step: apply.apply_junk(db, app, step) for step in ("junk", "dupes") if apply.pending(db, step)}
    p = plan(db, trust_scan=False)  # album_members below is the truth, not the scan
    uuids = sorted(
        {u for us in [*p["albums"].values(), *p["removals"].values()] for u in us}
        | set(p["keywords"])
        | set(p["locations"])
        | set(p["favorites"])
    )
    if not (uuids or p["renames"]):
        return out
    if not evals.has_baseline(db):  # Q11: measure Photos search before the first metadata write, or the effect can't be shown
        raise RuntimeError("Record the search baseline first: run `uv run sift-mac evals` with your library open in Photos.")
    PROGRESS.update(step="Checking the library")
    found = app.check_library(uuids) if uuids else set()
    PROGRESS.update(
        total=sum(
            len([u for u in us if u in found])
            for us in [*p["albums"].values(), *p["removals"].values(), p["keywords"], p["locations"], p["favorites"]]
        )
    )
    run = db.execute("insert into runs (step, created) values ('table', ?)", (datetime.now(UTC).isoformat(),)).lastrowid
    journal = lambda rows: db.executemany("insert into journal (run_id, uuid, field, before, after) values (?, ?, ?, ?, ?)", rows)

    for pile, old, new in p["renames"]:
        app.rename_album(old, new)
        journal([(run, pile, "album_name", old, new)])
        db.execute("update piles set applied_name=? where pile=?", (new, pile))
        db.execute("update journal set after=? where field='album' and after=?", (new, old))  # members now sit in the new name
        db.commit()

    added = 0
    for title, us in p["albums"].items():
        us = [u for u in us if u in found]
        PROGRESS.update(step=f"Album “{title}”")
        new = sorted(set(us) - app.album_members(title))
        refused = app.add_to_album(new, title) if new else set()
        journal([(run, u, "album", None, title) for u in new if u not in refused])
        added += len(new) - len(refused)
        db.execute("update piles set applied_name=name where name=?", (title,))
        db.executemany("delete from album_adds where uuid=? and album=?", [(u, title) for u in us])
        db.commit()  # journalled per album, so a failure later in this apply still leaves an undoable run
        PROGRESS["done"] += len(us)

    taken_out = 0
    for title, us in p["removals"].items():
        PROGRESS.update(step=f"Out of “{title}”")
        gone = app.album_members(title) & {u for u in us if u in found}
        if gone:
            app.rebuild_album_without(gone, title)  # an event album left empty is deleted
        journal([(run, u, "album_remove", title, None) for u in sorted(gone)])
        taken_out += len(gone)
        db.commit()
        PROGRESS["done"] += len([u for u in us if u in found])

    changed = 0
    if p["keywords"]:
        ids = [u for u in p["keywords"] if u in found]
        PROGRESS.update(step="Keywords")
        current = app.get_keywords(ids)
        after = {}
        for u in ids:
            adds, removes = p["keywords"][u]
            words = [w for w in current.get(u, []) if w not in removes] + [w for w in adds if w not in current.get(u, [])]
            if words != current.get(u, []):
                after[u] = words
        if after:
            app.set_keywords(after)
        journal([(run, u, "keywords", json.dumps(current.get(u, [])), json.dumps(w)) for u, w in after.items()])
        db.executemany("update assets set keywords=? where uuid=?", [(json.dumps(w), u) for u, w in after.items()])
        db.executemany("delete from tag_edits where uuid=?", [(u,) for u in ids])
        changed = len(after)
        PROGRESS["done"] += len(ids)
    db.commit()

    pinned = 0
    if p["locations"]:
        ids = [u for u in p["locations"] if u in found]
        PROGRESS.update(step="Locations")
        current = app.get_locations(ids)
        todo = {u: p["locations"][u] for u in ids if current.get(u) is None}  # one that got a location meanwhile keeps it
        PROGRESS["done"] += len(ids) - len(todo)
        items = sorted(todo.items())
        for start in range(0, len(items), photos_app.BATCH):  # one batch at a time, so the bar moves
            app.set_locations(dict(items[start : start + photos_app.BATCH]))
            PROGRESS["done"] += len(items[start : start + photos_app.BATCH])
        journal([(run, u, "location", None, json.dumps(list(v))) for u, v in todo.items()])
        db.commit()
        pinned = len(todo)

    faved = 0
    if p["favorites"]:
        ids = [u for u in p["favorites"] if u in found]
        PROGRESS.update(step="Favourites")
        current = app.get_favorites(ids)
        todo = [u for u in ids if not current.get(u)]
        if todo:
            app.set_favorites({u: True for u in todo})
        journal([(run, u, "favorite", "false", "true") for u in todo])
        db.executemany("update assets set favorite=1 where uuid=?", [(u,) for u in ids])
        db.executemany("delete from fav_edits where uuid=?", [(u,) for u in ids])
        db.commit()
        faved = len(todo)
        PROGRESS["done"] += len(ids)
    db.execute("delete from edit_log")  # what is in Photos now is undone through the run, not edit by edit
    db.commit()
    out["table"] = {
        "run": run,
        "renamed": len(p["renames"]),
        "added": added,
        "keywords": changed,
        "locations": pinned,
        "favorites": faved,
        "removed": taken_out,
        "deleted": len(uuids) - len(found),
    }
    return out

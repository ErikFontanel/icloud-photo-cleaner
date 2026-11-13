"""Events step. Data first: sessions by time gap and GPS jump, chained into trips by camera, time, look and keywords.
Events with GPS away from home or an occasion label qualify by rule; large events without GPS go to the local model to judge."""

import json
import math
import os
import re
import sqlite3
import unicodedata
from collections import Counter

import numpy as np
from scipy.spatial import cKDTree

from . import config, dupes, llm

GAP_H = 6  # a gap longer than this starts a new event
JUMP_KM = 50  # so does a GPS jump further than this
MIN_PHOTOS = 8
AWAY_KM = 30  # an event counts when its place is further than this from home at that date
OCCASION = {
    "Wedding",
    "Ceremony",
    "Cake",
    "Concert",
    "Rock Concert",
    "Stage",
    "Performance",
    "Christmas Tree",
    "Christmas Decoration",
    "Race Track",
    "Motor Sport",
    "Skiing",
    "Ski Run",
    "Winter Sport",
    "Barbecue Grill",
}
MIN_OCCASION_PHOTOS = 2  # at home, an occasion needs at least this many labelled photos
CHAIN_H = 24  # sessions this close can be one trip ...
VIBE_DIST = 0.6  # ... when from the same camera and their mean feature prints are this close (a session's own spread is ~0.58)
LABEL_OVERLAP = 0.4  # ... or when their top distinctive keywords overlap this much (Jaccard)
COMMON = 0.05  # keywords on more than this share of photos (Outdoor, Sky, Plant) say nothing about a trip
GUESS_MIN = 20  # an event without GPS needs this many photos before the model judges it
JUDGE_MODEL = "qwen3.5:4b"
JUDGE_SCHEMA = {
    "type": "object",
    "required": ["kind", "name", "city", "country"],
    "properties": {
        "kind": {"type": "string", "enum": ["trip", "occasion", "everyday"]},
        "name": {"type": "string"},
        "city": {"type": "string"},
        "country": {"type": "string"},
    },
}


def km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def homes() -> list[dict]:
    """SIFT_HOMES from .env: `city,lat,lon[,until]` per home, separated by `;`, in date order."""
    out = []
    for part in filter(None, (p.strip() for p in os.environ.get("SIFT_HOMES", "").split(";"))):
        city, lat, lon, *until = (f.strip() for f in part.split(","))
        out.append({"city": city, "lat": float(lat), "lon": float(lon), **({"until": until[0]} if until else {})})
    return out


def home_at(date: str, homes_: list[dict]) -> tuple[float, float] | None:
    h = _home(date, homes_)
    return (h["lat"], h["lon"]) if h else None


def _home(date: str, homes_: list[dict]) -> dict | None:
    for h in homes_:  # ordered; the first whose `until` is after the date applies
        if "until" not in h or date[:10] < h["until"]:
            return h
    return None


# Administrative suffixes GeoNames keeps in city names: Japanese -shi/-ku/-machi/-cho/-mura, Korean -si/-gun/-eup.
SUFFIX = re.compile(r"[- ](shi|ku|machi|cho|chō|mura|si|gun|eup)$")


def fold(name: str) -> str:
    """Lower case without accents, as GeoNames' ASCII names: "Nürburg" -> "nurburg", "Zürich" -> "zurich"."""
    return "".join(c for c in unicodedata.normalize("NFKD", name.strip().lower()) if not unicodedata.combining(c))


class Places:
    """Offline reverse geocoding over GeoNames cities1000 (CC BY 4.0)."""

    def __init__(self):
        rows = []
        with open(config.geonames_dir() / "cities1000.txt", encoding="utf-8") as f:
            for line in f:
                c = line.split("\t")
                rows.append((c[1], float(c[4]), float(c[5]), c[8], int(c[14] or 0), c[2].lower()))
        self.rows = rows
        self.countries: dict[str, str] = {}  # ISO code, ISO3 code or English name, lower case -> ISO code
        self.country_names: dict[str, str] = {}  # ISO code -> English name
        info = config.geonames_dir() / "countryInfo.txt"
        if info.exists():
            for line in info.read_text(encoding="utf-8").splitlines():
                c = line.split("\t")
                if not line.startswith("#") and len(c) > 4:
                    self.countries.update({c[0].lower(): c[0], c[1].lower(): c[0], c[4].lower(): c[0]})
                    self.country_names[c[0]] = c[4]
        self.by_name: dict[str, list] = {}
        for r in rows:
            self.by_name.setdefault(r[5], []).append(r)
            base = SUFFIX.sub("", r[5])  # "nara-shi" is Nara, Japan: findable as "nara" too
            if base != r[5] and len(base) > 2:
                self.by_name.setdefault(base, []).append(r)
        self.by_initial: dict[str, list[str]] = {}  # names by first letter, for typo matching
        for name in self.by_name:
            self.by_initial.setdefault(name[:1], []).append(name)
        lat, lon = np.radians([r[1] for r in rows]), np.radians([r[2] for r in rows])
        self.tree = cKDTree(np.c_[np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])

    def nearest(self, lat: float, lon: float) -> dict:
        la, lo = math.radians(lat), math.radians(lon)
        _, i = self.tree.query([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
        name, clat, clon, country, *_ = self.rows[i]
        return {"city": name, "country": country, "lat": clat, "lon": clon}

    def find(self, city: str, country: str = "", min_population: int = 0) -> dict | None:
        """The most populous GeoNames place with this name, in this country (ISO code) when given."""
        city = fold(city)
        hits = [r for r in self.by_name.get(city, []) if (not country or r[3] == country.strip().upper()) and r[4] >= min_population]
        if not hits:
            return None
        name, lat, lon, cc, *_ = max(hits, key=lambda r: r[4])
        if fold(name) != city and SUFFIX.sub("", fold(name)) == city:
            name = re.sub(r"[- ]\w+$", "", name)  # found without its suffix: show "Nara", not "Nara-shi"
        return {"city": name, "country": cc, "lat": lat, "lon": lon}


def _rows(db: sqlite3.Connection, include_marked: bool = False):
    """Photos that can be in an event: analysed, with a real date, and (unless include_marked) not marked as junk
    or as a duplicate to delete."""
    uuids, t, _, imported = dupes.load(db, include_junk=include_marked)  # flags the import hours
    skip = set() if include_marked else {u for (u,) in db.execute("select uuid from decisions where step='dupes' and choice='accept'")}
    meta = {
        u: (d, la, lo, json.loads(l or "[]"), c or "", np.frombuffer(f, dtype=np.float32))
        for u, d, la, lo, l, c, f in db.execute("select uuid, date, lat, lon, labels, camera, fp from assets where status='analysed'")
    }
    return [(u, ts, *meta[u]) for u, ts, imp in zip(uuids, t, imported) if not imp and u not in skip]


def sessions(rows) -> list[list]:
    groups, cur, last_gps = [], [], None
    for r in rows:
        lat, lon = r[3], r[4]
        jump = lat is not None and last_gps is not None and km(last_gps, (lat, lon)) > JUMP_KM
        if cur and (r[1] - cur[-1][1] > GAP_H * 3600 or jump):
            groups.append(cur)
            cur, last_gps = [], None
        cur.append(r)
        if lat is not None:
            last_gps = (lat, lon)
    return groups + [cur] if cur else groups


def common(rows) -> set[str]:
    n = Counter(l for r in rows for l in set(r[5]))
    return {l for l, c in n.items() if c > COMMON * len(rows)}


def _profile(s, common_: set[str] = frozenset()) -> tuple[str, np.ndarray, set[str]]:
    camera = Counter(r[6] for r in s).most_common(1)[0][0]
    keywords = {l for l, _ in Counter(l for r in s for l in r[5] if l not in common_).most_common(10)}
    return camera, np.mean([r[7] for r in s], axis=0), keywords


def chain(groups: list[list], common_: set[str] = frozenset()) -> list[list]:
    """Join neighbouring sessions of one trip: close in time, same camera, and alike in look or distinctive keywords."""
    out = []
    for g in groups:
        if out:
            a, b = _profile(out[-1], common_), _profile(g, common_)
            overlap = len(a[2] & b[2]) / max(1, len(a[2] | b[2]))
            if (
                g[0][1] - out[-1][-1][1] <= CHAIN_H * 3600
                and a[0]
                and a[0] == b[0]
                and (np.linalg.norm(a[1] - b[1]) < VIBE_DIST or overlap >= LABEL_OVERLAP)
            ):
                out[-1] = out[-1] + g
                continue
        out.append(g)
    return out


def detect(db: sqlite3.Connection, places: Places | None = None) -> list[dict]:
    """Events, each with a reason; reason None means no GPS and no occasion, so the model must judge it (see guess)."""
    homes_ = homes()
    places = places or Places()
    events = []
    rows = _rows(db)
    for g in chain(sessions(rows), common(rows)):
        if len(g) < MIN_PHOTOS:
            continue
        gps = [(r[3], r[4]) for r in g if r[3] is not None]
        occasion = Counter(l for r in g for l in r[5] if l in OCCASION)
        home = home_at(g[0][2], homes_)
        place, away_km = None, None
        if gps:
            near = [places.nearest(*p) for p in gps]
            city = Counter(n["city"] for n in near).most_common(1)[0][0]
            place = next(n for n in near if n["city"] == city)
            if home:
                away_km = round(km((place["lat"], place["lon"]), home))
        reason = None
        if away_km is not None and away_km > AWAY_KM:
            reason = f"{away_km} km from home"
        elif sum(occasion.values()) >= MIN_OCCASION_PHOTOS:
            reason = ", ".join(l for l, _ in occasion.most_common(2))
        if reason or (not gps and len(g) >= GUESS_MIN):
            events.append(
                {
                    "start": g[0][2],
                    "end": g[-1][2],
                    "uuids": [r[0] for r in g],
                    "gps": len(gps),
                    "place": place,
                    "reason": reason,
                    "camera": _profile(g)[0],
                    "labels": [l for l, _ in Counter(l for r in g for l in r[5]).most_common(8)],
                }
            )
    return events


def _thumbs(db: sqlite3.Connection, uuids: list[str], n: int = 4) -> list[str]:
    """Best-scoring photo from each of n equal stretches of the event, as the model's view of it."""
    meta = {
        u: (p, sc or 0)
        for u, p, sc in db.execute(f"select uuid, preview, score from assets where uuid in ({','.join('?' * len(uuids))})", uuids)
    }
    parts = [uuids[i * len(uuids) // n : (i + 1) * len(uuids) // n] for i in range(n)]
    return [max(part, key=lambda u: meta[u][1]) for part in parts if part]


def judge(db: sqlite3.Connection, event: dict, places: Places, model: str = JUDGE_MODEL) -> dict:
    """Ask the local model whether an event without GPS is a trip or occasion, and for a name and city guess.
    A city is kept only when GeoNames knows it; it stays a suggestion until the user approves the name."""
    home = _home(event["start"], homes())
    start, end = event["start"][:10], event["end"][:10]
    prompt = (
        "These photos are one group from a personal photo library: "
        f"{len(event['uuids'])} photos from {start} to {end}, camera {event['camera'] or 'unknown'}, "
        f"Apple scene keywords: {', '.join(event['labels'])}. "
        f"The owner lived in {home['city'] if home else 'an unknown place'} then. "
        "The 4 images are spread over the group. Decide: is this a trip away from home, an occasion "
        "(wedding, party, concert, holiday), or everyday life at home? Always give a short name like "
        "'Lisbon weekend', 'Birthday party' or 'Garden in spring'. Give a city and ISO country code only if the images clearly show "
        "where it is (landmark, sign, language); otherwise leave both empty."
    )
    images = [
        llm.thumb(p)
        for (p,) in (db.execute("select preview from assets where uuid=?", (u,)).fetchone() for u in _thumbs(db, event["uuids"]))
    ]
    r = llm.chat(model, prompt, JUDGE_SCHEMA, images)
    place = places.find(r["city"], r["country"]) if r["city"] else None
    return {
        "event": r["kind"] in ("trip", "occasion"),
        "kind": r["kind"],
        "name": r["name"].strip(),
        "place": place,
        "said_city": r["city"],
    }


def judge_all(db: sqlite3.Connection, places: Places | None = None) -> Counter:
    """Judge every event without GPS or occasion that has no stored guess for exactly these photos. Returns kinds judged."""
    places = places or Places()
    done = {f: u for f, u in db.execute("select first, uuids from event_guesses")}
    todo = [e for e in detect(db, places) if not e["reason"] and done.get(e["uuids"][0]) != json.dumps(e["uuids"])]
    kinds = Counter()
    with llm.serve():
        for i, e in enumerate(todo, 1):
            r = judge(db, e, places)
            db.execute("insert or replace into event_guesses values (?, ?, ?)", (e["uuids"][0], json.dumps(e["uuids"]), json.dumps(r)))
            db.commit()
            kinds[r["kind"]] += 1
            print(f"{i}/{len(todo)} judged", flush=True)
    return kinds

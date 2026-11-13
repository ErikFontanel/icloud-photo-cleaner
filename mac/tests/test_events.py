import json

import numpy as np
import pytest

from sift_mac import config, events, llm, state

CITIES = [  # name, lat, lon, country, population
    ("Lyon", 45.76404, 4.83566, "FR", 500000),
    ("Lisbon", 38.71667, -9.13333, "PT", 500000),
    ("Lisbon", 44.0, -70.1, "US", 9000),
]


@pytest.fixture
def places(monkeypatch):
    d = config.geonames_dir()
    d.mkdir(parents=True)
    (d / "cities1000.txt").write_text(
        "".join(
            "\t".join([str(i), n, n, "", str(la), str(lo), "P", "PPL", cc, "", "", "", "", "", str(pop), "", "", "", ""]) + "\n"
            for i, (n, la, lo, cc, pop) in enumerate(CITIES)
        )
    )
    monkeypatch.setenv("SIFT_HOMES", "Lyon,45.76404,4.83566")
    return events.Places()


@pytest.fixture
def db():
    return state.connect(config.state_db())


def add(db, uuid, date, fp=(0, 0), lat=None, lon=None, labels=(), camera="Apple iPhone 15 Pro", score=0.0):
    db.execute(
        "insert into assets (uuid, status, date, fp, lat, lon, labels, camera, score, preview) "
        "values (?, 'analysed', ?, ?, ?, ?, ?, ?, ?, ?)",
        (uuid, date, np.asarray(fp, np.float32).tobytes(), lat, lon, json.dumps(list(labels)), camera, score, f"/p/{uuid}.jpg"),
    )


def session(db, prefix, day, n, **kw):
    for i in range(n):
        add(db, f"{prefix}{i:02}", f"2024-06-{day:02}T10:{i:02}:00+00:00", **kw)


def test_gps_trip_away_from_home_is_an_event(db, places):
    session(db, "lis", 14, 10, lat=38.72, lon=-9.14)
    [e] = events.detect(db, places)
    assert e["place"]["city"] == "Lisbon" and e["reason"].endswith("km from home") and len(e["uuids"]) == 10


def test_small_group_at_home_without_gps_is_not_an_event(db, places):
    session(db, "home", 14, 10)
    assert events.detect(db, places) == []


def test_large_group_without_gps_goes_to_the_model(db, places):
    session(db, "big", 14, 25)
    [e] = events.detect(db, places)
    assert e["reason"] is None and e["gps"] == 0


def test_sessions_of_one_camera_and_look_chain_into_one_trip(db, places):
    session(db, "d1", 14, 12, camera="Canon PowerShot G9 X")
    session(db, "d2", 15, 12, camera="Canon PowerShot G9 X")  # next day, same camera, same look: one trip
    session(db, "d3", 16, 12, camera="Apple iPhone 15 Pro")  # next day but another camera: its own group
    groups = events.chain(events.sessions(events._rows(db)))
    assert [len(g) for g in groups] == [24, 12]


def test_common_keywords_do_not_chain_sessions_that_look_different(db, places):
    session(db, "a", 14, 10, fp=(0, 0), labels=["Outdoor", "Sky"])
    session(db, "b", 15, 10, fp=(2, 0), labels=["Outdoor", "Sky"])
    rows = events._rows(db)
    assert len(events.chain(events.sessions(rows), {"Outdoor", "Sky"})) == 2
    assert len(events.chain(events.sessions(rows))) == 1  # the same keywords would chain them if they counted


def test_places_find_prefers_country_then_population(places):
    assert places.find("lisbon")["country"] == "PT"
    assert places.find("Lisbon", "us")["country"] == "US"
    assert places.find("Atlantis") is None


def test_judge_keeps_only_cities_geonames_knows(db, places, monkeypatch):
    session(db, "big", 14, 25)
    [e] = events.detect(db, places)
    seen = {}

    def fake_chat(model, prompt, schema, images=()):
        seen.update(prompt=prompt, images=len(images))
        return answer

    monkeypatch.setattr(llm, "chat", fake_chat)
    monkeypatch.setattr(llm, "thumb", lambda path: path)

    answer = {"kind": "trip", "name": "Lisbon weekend", "city": "Lisbon", "country": "PT"}
    r = events.judge(db, e, places)
    assert r["event"] and r["place"]["country"] == "PT" and r["name"] == "Lisbon weekend"
    assert seen["images"] == 4 and "Apple iPhone 15 Pro" in seen["prompt"] and "Lyon" in seen["prompt"]

    answer = {"kind": "trip", "name": "Beach day", "city": "Atlantis", "country": ""}
    assert events.judge(db, e, places)["place"] is None

    answer = {"kind": "everyday", "name": "Garden", "city": "", "country": ""}
    assert not events.judge(db, e, places)["event"]

import json

import pytest

from sift_mac import apply, config, edits, state


class FakePhotos:
    """In-memory stand-in for photos_app: albums and keywords per photo."""

    TO_DELETE = "Sift – To Delete"

    def __init__(self, photos):
        self.photos = set(photos)
        self.albums: dict[str, set[str]] = {}
        self.keywords = {u: [] for u in photos}
        self.calls = []
        self.locations: dict[str, tuple | None] = {}
        self.favorites: set[str] = set()

    def check_library(self, uuids, found=None):
        return self.photos & set(uuids)

    def album_members(self, name=TO_DELETE):
        return set(self.albums.get(name, set()))

    def add_to_album(self, uuids, name=TO_DELETE):
        self.albums.setdefault(name, set()).update(uuids)
        return set()

    def rebuild_album_without(self, remove, name=TO_DELETE):
        gone = self.albums.get(name, set()) & remove
        self.albums[name] = self.albums.get(name, set()) - remove
        if not self.albums[name] and name != self.TO_DELETE:
            del self.albums[name]
        return len(gone)

    def get_keywords(self, uuids):
        return {u: list(self.keywords[u]) for u in uuids}

    def set_keywords(self, kw):
        self.calls.append(("set_keywords", dict(kw)))
        self.keywords.update({u: list(w) for u, w in kw.items()})

    def rename_album(self, old, new):
        self.albums[new] = self.albums.pop(old)

    def get_locations(self, uuids):
        return {u: self.locations.get(u) for u in uuids}

    def set_locations(self, locs):
        self.locations.update(locs)

    def get_favorites(self, uuids):
        return {u: u in self.favorites for u in uuids}

    def set_favorites(self, favs):
        self.favorites |= {u for u, f in favs.items() if f}
        self.favorites -= {u for u, f in favs.items() if not f}


PHOTOS = ["a1", "a2", "a3", "b1", "b2"]


CITIES = [
    ("Lisbon", 38.71667, -9.13333, "PT", 500000),
    ("Porto", 41.14961, -8.61099, "PT", 250000),
    ("Spa", 50.48375, 5.86674, "BE", 10756),
    ("Francorchamps", 50.45353, 5.95276, "BE", 2023),
    ("Nurburg", 50.34306, 6.95194, "DE", 160),
    ("Nara-shi", 34.68505, 135.80485, "JP", 367353),
    ("Nara", 15.16667, -7.28333, "ML", 23599),
]


@pytest.fixture
def db(monkeypatch):
    d = config.geonames_dir()
    d.mkdir(parents=True)
    (d / "cities1000.txt").write_text(
        "".join(
            "\t".join([str(i), n, n, "", str(la), str(lo), "P", "PPL", cc, "", "", "", "", "", str(pop), "", "", "", ""]) + "\n"
            for i, (n, la, lo, cc, pop) in enumerate(CITIES)
        )
    )
    (d / "countryInfo.txt").write_text("#ISO\tISO3\nPT\tPRT\t620\tPO\tPortugal\nJP\tJPN\t392\tJA\tJapan\n")
    monkeypatch.setattr(edits, "_places", None)
    monkeypatch.setattr(edits, "apple_maps", lambda text, cc="": None)  # unit tests never ask Apple
    db = state.connect(config.state_db())
    for u in PHOTOS:
        db.execute(
            "insert into assets (uuid, status, keywords, albums) values (?, 'analysed', ?, ?)",
            (u, json.dumps(["Beach"] if u == "a1" else []), json.dumps(["Holidays"] if u == "b1" else [])),
        )
    db.execute("insert into eval_runs values ('baseline', 'now', 'q', '[]')")  # apply needs a search baseline
    db.commit()
    manifest = {
        "groups": [{"key": "a1", "label": "", "kind": ""}, {"key": "b1", "label": "", "kind": ""}],
        "photos": [{"u": u, "g": 0 if u.startswith("a") else 1, "t": t} for t, u in enumerate(PHOTOS)],
    }
    monkeypatch.setattr(edits.table, "manifest", lambda db: manifest)
    return db


def test_marks_are_junk_decisions_shared_with_the_grid(db):
    edits.sync(db, marked=["a2", "b2"])
    assert set(apply.pending(db, "junk")) == {"a2", "b2"}
    db.execute("update decisions set run_id=7 where uuid='b2'")  # b2 was applied meanwhile
    edits.sync(db, restored=["a2", "b2"])
    s = edits.state(db)
    assert s["marked"] == [] and s["gone"] == ["b2"]  # an applied mark is undone through its run, not here


def test_named_pile_becomes_an_album_of_its_photos_without_marked_ones(db):
    edits.name(db, "a1", "Lisbon weekend 2024")
    edits.sync(db, marked=["a3"], piles={"b2": "a1"})  # a3 goes to To Delete; b2 merged into the Lisbon pile
    assert edits.plan(db)["albums"] == {"Lisbon weekend 2024": ["a1", "a2", "b2"]}


def test_tag_edits_relative_to_the_scanned_keywords(db):
    edits.tags(db, ["a1", "a2"], add=["Lisbon"], remove=["Beach"])
    s = edits.state(db)
    assert s["tags"] == {"a1": ["Lisbon"], "a2": ["Lisbon"]} and s["tag_index"] == ["Lisbon"]
    edits.tags(db, ["a1"], add=["Beach"])  # the latest wish wins; apply writes only what differs from Photos
    assert db.execute("select keyword, op from tag_edits where uuid='a1' order by keyword").fetchall() == [
        ("Beach", "add"),
        ("Lisbon", "add"),
    ]


def test_apply_writes_albums_and_keywords_and_undo_reverts_them(db):
    app = FakePhotos(PHOTOS)
    app.keywords["a1"] = ["Beach"]
    edits.name(db, "a1", "Lisbon")
    edits.album(db, ["b2"], "Best of")
    edits.tags(db, ["a2"], add=["Family"])
    r = edits.apply_all(db, app)["table"]
    assert app.albums == {"Lisbon": {"a1", "a2", "a3"}, "Best of": {"b2"}} and app.keywords["a2"] == ["Family"]
    assert r["added"] == 4 and r["keywords"] == 1
    assert edits.pending(db) == {
        "delete": 0,
        "renames": 0,
        "albums": 0,
        "album_photos": 0,
        "keywords": 0,
        "locations": 0,
        "favorites": 0,
        "album_removals": 0,
    }

    edits.name(db, "a1", "Lisbon weekend")  # renaming an applied pile renames the album
    r2 = edits.apply_all(db, app)["table"]
    assert set(app.albums) == {"Lisbon weekend", "Best of"} and r2["renamed"] == 1 and r2["added"] == 0

    apply.undo(db, r2["run"], app)
    assert set(app.albums) == {"Lisbon", "Best of"}
    apply.undo(db, r["run"], app)
    assert app.albums == {} and app.keywords["a2"] == [] and app.keywords["a1"] == ["Beach"]


def test_bad_names_are_refused(db):
    with pytest.raises(ValueError):
        edits.name(db, "a1", "  \t ")


def test_apply_refuses_metadata_writes_without_a_search_baseline(db):
    db.execute("delete from eval_runs")
    edits.name(db, "a1", "Lisbon")
    with pytest.raises(RuntimeError, match="baseline"):
        edits.apply_all(db, FakePhotos(PHOTOS))


def test_a_named_pile_keeps_its_name_after_a_rescan_changes_its_key(db, monkeypatch):
    edits.name(db, "a1", "Lisbon")
    edits.sync(db, piles={"b2": "a1"})  # b2 merged into the Lisbon pile
    # a rescan found an earlier photo a0 in the same session: the pile's key is now a0
    db.execute("insert into assets (uuid, status) values ('a0', 'analysed')")
    rebuilt = {
        "groups": [{"key": "a0", "label": "", "kind": ""}, {"key": "b1", "label": "", "kind": ""}],
        "photos": [{"u": u, "g": 0 if u.startswith("a") else 1, "t": t} for t, u in enumerate(["a0", *PHOTOS])],
    }
    monkeypatch.setattr(edits.table, "manifest", lambda db: rebuilt)
    s = edits.state(db)
    assert s["names"] == {"a0": "Lisbon"} and s["pile_of"] == {"b2": "a0"}
    assert edits.plan(db)["albums"] == {"Lisbon": ["a0", "a1", "a2", "a3", "b2"]}


def test_piles_list_matches_the_table(db):
    edits.name(db, "a1", "Lisbon")
    edits.sync(db, marked=["a3"], piles={"b1": "a1"})
    piles = {p["key"]: p for p in edits.piles(db)}
    assert piles["a1"]["name"] == "Lisbon" and piles["a1"]["uuids"] == ["a1", "a2", "b1"]  # a3 marked, b1 merged in
    assert piles["b1"]["uuids"] == ["b2"]


def test_a_place_pins_only_the_photos_without_gps_and_undo_clears_the_pins(db):
    db.execute("update assets set lat=41.15, lon=-8.61 where uuid='a1'")  # a1 has GPS (Porto); a2, a3 have none
    db.commit()
    piles = {p["key"]: p for p in edits.piles(db)}
    assert [(g["city"], g["uuids"]) for g in piles["a1"]["spots"]] == [("Porto", ["a2", "a3"])]
    edits.set_place(db, ["a1", "a2", "a3"], "Lisbon, PT")  # a1 keeps its GPS
    edits.sync(db, marked=["a3"])  # a marked photo gets no pin
    assert edits.plan(db)["locations"] == {"a2": (38.71667, -9.13333)}
    app = FakePhotos(PHOTOS)
    r = edits.apply_all(db, app)["table"]
    assert r["locations"] == 1 and app.locations == {"a2": (38.71667, -9.13333)}
    assert edits.pending(db)["locations"] == 0  # a pinned photo counts as having a location
    apply.undo(db, r["run"], app)
    assert app.locations == {"a2": None} and edits.pending(db)["locations"] == 1


def test_one_trip_gets_a_city_per_photo_from_the_gps_photo_nearest_in_time(db):
    # a1 Porto and a3 Lisbon have GPS; a2 is taken nearest a1, a4 nearest a3
    db.execute("update assets set lat=41.15, lon=-8.61 where uuid='a1'")
    db.execute("update assets set lat=38.72, lon=-9.13 where uuid='a3'")
    db.execute("insert into assets (uuid, status) values ('a4', 'analysed')")
    db.commit()
    info, times = edits._info(db), {"a1": 0, "a2": 10, "a3": 100, "a4": 90}
    got = edits.spots(["a1", "a2", "a3", "a4"], "", info, {}, times, {})
    assert [(g["city"], g["uuids"]) for g in got] == [("Porto", ["a2"]), ("Lisbon", ["a4"])]
    got = edits.spots(["a1", "a2", "a3", "a4"], "", info, {}, times, {"a4": {"city": "Porto", "country": "PT", "lat": 1, "lon": 2}})
    assert [(g["city"], g["set"], g["uuids"]) for g in got] == [("Porto", False, ["a2"]), ("Porto", True, ["a4"])]


def test_a_pin_never_overwrites_a_location_set_in_photos_meanwhile(db):
    edits.set_place(db, ["b1", "b2"], "Lisbon")
    app = FakePhotos(PHOTOS)
    app.locations["b2"] = (1.0, 2.0)
    edits.apply_all(db, app)
    assert app.locations == {"b1": (38.71667, -9.13333), "b2": (1.0, 2.0)}


def test_unknown_places_are_refused_and_a_city_in_the_name_is_suggested(db):
    with pytest.raises(ValueError, match="GeoNames"):
        edits.set_place(db, ["a1"], "Atlantis")
    edits.name(db, "a1", "Weekend Lisbon 2024")
    assert {p["key"]: p for p in edits.piles(db)}["a1"]["spots"][0]["city"] == "Lisbon"


def test_best_of_suggests_top_scores_and_counts_existing_favourites(db):
    many = [f"c{i:03}" for i in range(120)]
    db.executemany(
        "insert into assets (uuid, status, score, favorite, utility, screenshot) values (?, 'analysed', ?, ?, ?, 0)",
        [(u, i / 100, int(u == "c000"), int(u == "c119")) for i, u in enumerate(many)],
    )
    db.commit()
    info = edits._info(db)
    # 120 photos: 3 + 2 = 5 wanted; c000 is a favourite already; c119 scores best but is a utility shot
    assert edits.best_of(many, info) == ["c118", "c117", "c116", "c115"]
    assert edits.best_of(many, info, chosen={"c118"}) == ["c117", "c116", "c115"]


def test_favourites_apply_and_undo_only_touch_what_sift_set(db):
    app = FakePhotos(PHOTOS)
    app.favorites = {"b1"}
    db.execute("update assets set favorite=1 where uuid='b1'")
    db.commit()
    edits.favorite(db, ["a1", "b1"])  # b1 is a favourite already
    assert edits.plan(db)["favorites"] == ["a1"]
    r = edits.apply_all(db, app)["table"]
    assert app.favorites == {"a1", "b1"} and r["favorites"] == 1
    apply.undo(db, r["run"], app)
    assert app.favorites == {"b1"}


def test_kept_piles_follow_their_photos_after_a_rescan(db, monkeypatch):
    edits.keep(db, "a1")
    rebuilt = {
        "groups": [{"key": "a0", "label": "", "kind": ""}, {"key": "b1", "label": "", "kind": ""}],
        "photos": [{"u": u, "g": 0 if u.startswith("a") else 1, "t": t} for t, u in enumerate(["a0", *PHOTOS])],
    }
    db.execute("insert into assets (uuid, status) values ('a0', 'analysed')")
    monkeypatch.setattr(edits.table, "manifest", lambda db: rebuilt)
    s = edits.state(db)
    assert s["kept"] == ["a0"]


@pytest.mark.parametrize(
    "text, want",
    [
        ("35.0116, 135.7681", (35.0116, 135.7681)),
        ("35.0116N 135.7681E", (35.0116, 135.7681)),
        ("33.8688° S, 70.6693° W", (-33.8688, -70.6693)),
        ("S 33.8688, W 70.6693", (-33.8688, -70.6693)),
        ("-33.8688;-70.6693", (-33.8688, -70.6693)),
        ("https://www.google.com/maps/place/x/@35.0116,135.7681,15z", (35.0116, 135.7681)),
        ("https://maps.apple.com/?ll=35.0116,135.7681&q=Kyoto", (35.0116, 135.7681)),
        ("54°51'11.9\"N 3°55'40.2\"W", (54.853306, -3.927833)),
        ("https://www.google.com/maps/place/54%C2%B051'11.9%22N+3%C2%B055'40.2%22W/@54.8533,-3.9278,17z", (54.853306, -3.927833)),
        ("https://www.google.com/maps/place/Kyoto/@35.0,135.7,12z/data=!4m6!3m5!1s0x0:0x0!8m2!3d35.0116!4d135.7681", (35.0116, 135.7681)),
        ("Lisbon, PT", None),
    ],
)
def test_coordinates_in_the_forms_people_paste(text, want):
    assert edits.coordinates(text) == want


def test_coordinates_off_earth_or_swapped_are_refused():
    with pytest.raises(ValueError, match="Earth"):
        edits.coordinates("95.1, 10")
    with pytest.raises(ValueError, match="latitude first"):
        edits.coordinates("135.7681E, 35.0116N")


def test_typed_coordinates_pin_exactly_and_are_named_after_the_nearest_city(db):
    edits.set_place(db, ["b1"], "38.7, -9.2")
    edits.set_place(db, ["b2"], "Lisbon")
    assert edits.plan(db)["locations"] == {"b1": (38.7, -9.2), "b2": (38.71667, -9.13333)}
    got = {p["key"]: p for p in edits.piles(db)}["b1"]["spots"]
    assert [(g["city"], g["exact"], g["uuids"]) for g in got] == [("Lisbon", True, ["b1"]), ("Lisbon", False, ["b2"])]


@pytest.mark.parametrize("text", ["Porto, PT", "Porto, PRT", "Porto, Portugal", "Porto, SP", "porto"])  # SP: unknown
def test_a_wrong_or_spelled_out_country_still_finds_the_city(db, text):
    assert edits.set_place(db, ["b1"], text)["country"] == "PT"


@pytest.mark.parametrize(
    "text, town",
    [
        ("Circuit Spa-Francorchamps", "Francorchamps"),
        ("Circuit Spa-Francochamps", "Francorchamps"),
        ("Spa, Belgium", "Spa"),
        ("Nürburgring", "Nurburg"),
        ("Nürburg", "Nurburg"),
        ("Lisbn", None),
    ],
)
def test_a_venue_or_typo_finds_the_town_in_its_name(db, text, town):
    if town:
        assert edits.set_place(db, ["b1"], text)["city"] == town
    else:  # too short to guess a typo
        with pytest.raises(ValueError):
            edits.set_place(db, ["b1"], text)


def test_a_venue_apple_maps_knows_is_pinned_exactly_with_its_name(db, monkeypatch):
    asked = []
    monkeypatch.setattr(
        edits,
        "apple_maps",
        lambda text, cc="": asked.append((text, cc)) or {"city": "Autodromo, Monza", "country": "IT", "lat": 45.6156, "lon": 9.2811},
    )
    edits.set_place(db, ["b2"], "Autodromo, Monza, IT")
    assert asked == [("Autodromo, Monza", "")]  # IT isn't in the test's country list
    edits.set_place(db, ["b1"], "Lisbon")  # Apple answers first, even for a city GeoNames knows
    assert edits.plan(db)["locations"]["b1"] == (45.6156, 9.2811)
    assert edits.plan(db)["locations"]["b2"] == (45.6156, 9.2811)


def test_undo_reverts_the_last_edits_one_by_one(db):
    edits.set_place(db, ["a2"], "Lisbon")
    edits.set_place(db, ["a2", "a3"], "Porto")
    edits.sync(db, piles={"b1": "a1", "b2": "a1"})  # merge the b pile into the a pile
    edits.sync(db, marked=["a3"])
    assert edits.state(db)["undo"] == "Delete 1 photo"
    assert edits.undo_edit(db) == "Delete 1 photo" and edits.state(db)["marked"] == []
    assert edits.undo_edit(db).startswith("Move") and edits.state(db)["pile_of"] == {}
    assert edits.undo_edit(db) == "Place of 2 photos"
    assert edits._chosen(db)["a2"]["city"] == "Lisbon" and "a3" not in edits._chosen(db)
    edits.undo_edit(db)
    assert edits._chosen(db) == {}
    with pytest.raises(ValueError, match="Nothing"):
        edits.undo_edit(db)


def test_undo_restores_names_tags_albums_keep_and_favourites(db):
    edits.name(db, "a1", "Lisbon")
    edits.name(db, "a1", "Lisbon 2024")
    edits.tags(db, ["a1"], add=["Beach"])
    edits.album(db, ["b2"], "Best of")
    edits.keep(db, "b1")
    edits.favorite(db, ["a2"])
    for _ in range(4):  # favourite, keep, album, tag
        edits.undo_edit(db)
    s = edits.state(db)
    assert s["names"] == {"a1": "Lisbon 2024"} and s["kept"] == [] and s["fav_edits"] == [] and s["album_adds"] == {}
    assert not db.execute("select 1 from tag_edits").fetchone()
    edits.undo_edit(db)  # the rename
    assert edits.state(db)["names"] == {"a1": "Lisbon"}


def test_apply_clears_the_edit_undo(db):
    edits.name(db, "a1", "Lisbon")
    edits.apply_all(db, FakePhotos(PHOTOS))
    assert edits.state(db)["undo"] is None


def test_a_photo_taken_out_of_an_event_album_before_apply_is_never_added(db):
    edits.name(db, "a1", "Lisbon")
    edits.album(db, ["a2"], "Lisbon", remove=True)
    assert edits.plan(db)["albums"] == {"Lisbon": ["a1", "a3"]} and edits.state(db)["album_removes"] == {"a2": ["Lisbon"]}
    edits.album(db, ["a2"], "Lisbon")  # put back
    assert edits.plan(db)["albums"] == {"Lisbon": ["a1", "a2", "a3"]}


def test_taking_a_photo_out_of_an_applied_album_rebuilds_it_and_undo_puts_it_back(db):
    app = FakePhotos(PHOTOS)
    edits.name(db, "a1", "Lisbon")
    edits.apply_all(db, app)
    edits.album(db, ["a2"], "Lisbon", remove=True)
    assert edits.pending(db)["album_removals"] == 1
    r = edits.apply_all(db, app)["table"]
    assert r["removed"] == 1 and app.albums["Lisbon"] == {"a1", "a3"}
    assert edits.pending(db)["album_removals"] == 0 and edits.plan(db)["albums"] == {}  # and it isn't added back
    assert "Lisbon" not in edits.state(db)["albums"].get("a2", [])
    apply.undo(db, r["run"], app)
    assert app.albums["Lisbon"] == {"a1", "a2", "a3"}


def test_your_own_photos_albums_are_never_taken_apart(db):
    edits.album(db, ["b1"], "Holidays", remove=True)  # b1 is in your album Holidays (scanned)
    assert edits.state(db)["album_removes"] == {} and edits.pending(db)["album_removals"] == 0


def test_nara_japan_is_found_under_its_geonames_name_nara_shi(db):
    assert edits.set_place(db, ["b1"], "Nara, JP")["country"] == "JP"
    assert edits.set_place(db, ["b1"], "Nara, Japan")["city"] == "Nara"


def test_a_named_country_is_never_swapped_for_another(db, monkeypatch):
    monkeypatch.setattr(edits, "apple_maps", lambda text, cc="": None)
    with pytest.raises(ValueError):
        edits.set_place(db, ["b1"], "Lisbon, JP")  # no Lisbon in Japan: refused, not Lisbon in Portugal


def test_an_update_returns_only_the_events_an_edit_touched(db):
    edits.tags(db, ["a1"], add=["Beach"])
    edits.sync(db, piles={"b1": "a1", "b2": "a1"})  # merge b into a
    r = edits.piles_update(db, ["a1", "b1"])
    assert [p["key"] for p in r["piles"]] == ["a1"] and r["gone"] == ["b1"]
    assert r["piles"][0]["uuids"] == ["a1", "a2", "a3", "b1", "b2"] and r["tags"] == {"a1": ["Beach"]}
    assert r["albums"] == {"b1": ["Holidays"]} and "pending" in r  # only the state of these photos


def test_apply_reports_progress_up_to_the_total_and_then_clears_it(db):
    edits.name(db, "a1", "Lisbon")  # an album of a1, a2, a3
    edits.set_place(db, ["a1", "a2"], "Lisbon, PT")
    seen = []
    app = FakePhotos(PHOTOS)
    real = app.set_locations
    app.set_locations = lambda locs: (seen.append(dict(edits.PROGRESS)), real(locs))
    edits.apply_all(db, app)
    assert seen and seen[0]["step"] == "Locations" and seen[0]["total"] == 5  # 3 album photos + 2 pins
    assert seen[0]["done"] == 3  # the album is done before the pins
    assert edits.PROGRESS == {"step": "", "done": 0, "total": 0}


def test_deciding_again_on_an_applied_photo_keeps_its_run(db):
    app = FakePhotos(PHOTOS)
    apply.decide(db, "junk", "blurry", ["a1"], [])
    run = apply.apply_junk(db, app)["run"]
    apply.decide(db, "junk", "dark", ["a1"], [])  # the photo shows up in a second group
    assert apply.pending(db, "junk") == [] and apply.apply_junk(db, app)["run"] is None
    apply.undo(db, run, app)
    assert app.album_members() == set() and db.execute("select count(*) from decisions").fetchone() == (0,)

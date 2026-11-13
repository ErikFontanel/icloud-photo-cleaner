import json

import pytest

from sift_mac import apply, config, junk, state


def add(db, uuid, score=0.3, utility=0, blur=0.9, screenshot=0, favorite=0, edited=0, labels=()):
    db.execute(
        "insert into assets (uuid, status, date, score, utility, blur, screenshot, favorite, edited, labels) values (?, 'analysed', '2024-06-14T10:00:00+01:00', ?, ?, ?, ?, ?, ?, ?)",
        (uuid, score, utility, blur, screenshot, favorite, edited, json.dumps(list(labels))),
    )


@pytest.fixture
def db():
    return state.connect(config.state_db())


def groups(db):
    return {g["key"]: [i["uuid"] for i in g["items"]] for g in junk.candidates(db)}


def test_groups_and_order(db):
    add(db, "shot", screenshot=1, score=0.5)
    add(db, "doc", utility=1, labels=["Document"])
    add(db, "util-machine", utility=1, labels=["Machine"])  # utility without a document label
    add(db, "blur-a", blur=0.3)
    add(db, "blur-b", blur=0.1)
    add(db, "low", score=-0.9)
    add(db, "fine", score=-0.5)  # above the -0.6 cut-off
    g = groups(db)
    assert g == {"screenshots": ["shot"], "documents": ["doc"], "utility": ["util-machine"], "blurry": ["blur-b", "blur-a"], "low": ["low"]}


def test_first_group_wins(db):
    add(db, "both", screenshot=1, blur=0.1, score=-0.9)
    g = groups(db)
    assert g["screenshots"] == ["both"] and g["blurry"] == [] and g["low"] == []


def test_favourites_and_edited_never_suggested_but_edited_screenshots_are(db):
    add(db, "fav", blur=0.1, favorite=1)
    add(db, "edit", blur=0.1, edited=1)
    add(db, "cropped-shot", screenshot=1, edited=1)
    add(db, "fav-shot", screenshot=1, edited=1, favorite=1)
    g = groups(db)
    assert g["blurry"] == [] and g["screenshots"] == ["cropped-shot"]


def test_decided_photos_leave_the_queue(db):
    add(db, "a", blur=0.1)
    add(db, "b", blur=0.2)
    apply.decide(db, "junk", "blurry", accept=["a"], reject=["b"])
    assert groups(db)["blurry"] == []
    assert apply.pending(db, "junk") == ["a"]


def test_sections_by_vision_class(db):
    db.execute("delete from assets")
    for i in range(3):
        add(db, f"r{i}", utility=1, labels=["Document"])
        db.execute("update assets set classes=? where uuid=?", (json.dumps({"receipt": 0.6, "document": 0.3}), f"r{i}"))
    add(db, "w", utility=1, labels=["Document"])
    db.execute("update assets set classes=? where uuid='w'", (json.dumps({"whiteboard": 0.4}),))
    add(db, "o", utility=1, labels=["Document"])
    db.execute("update assets set classes=? where uuid='o'", (json.dumps({"receipt": 0.01}),))
    docs = next(g for g in junk.candidates(db) if g["key"] == "documents")
    assert docs["sections"][0] == {"name": "Receipts", "count": 3}
    assert {s["name"] for s in docs["sections"]} == {"Receipts", "Whiteboards", "Other"}
    assert [i["section"] for i in docs["items"]][:3] == ["Receipts"] * 3


def test_similar_photos_sit_together(db):
    import numpy as np

    for u, fp in {"tv1": [0, 0], "rcpt1": [5, 5], "tv2": [0.1, 0], "rcpt2": [5, 5.1], "tv3": [0, 0.1]}.items():
        add(db, u, blur=0.1)
        db.execute("update assets set fp=? where uuid=?", (np.asarray(fp, np.float32).tobytes(), u))
    order = groups(db)["blurry"]
    tv = [order.index(u) for u in ("tv1", "tv2", "tv3")]
    assert max(tv) - min(tv) == 2  # the three TV photos are adjacent


def test_items_carry_their_albums_without_to_delete(db):
    from sift_mac.photos_app import TO_DELETE

    add(db, "a", blur=0.1)
    db.execute("update assets set albums=? where uuid='a'", (json.dumps(["Kyoto 2024", TO_DELETE]),))
    add(db, "b", blur=0.2)
    items = {i["uuid"]: i["albums"] for g in junk.candidates(db) for i in g["items"]}
    assert items == {"a": ["Kyoto 2024"], "b": []}

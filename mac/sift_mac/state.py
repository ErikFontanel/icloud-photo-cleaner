"""Local state database: scanned assets, apply runs and the write journal used by undo."""

import sqlite3
from pathlib import Path

SCHEMA = """
create table if not exists assets (
    uuid text primary key,
    modified text,
    status text not null default 'new',  -- new | analysed | skipped (no local preview)
    date text,                            -- ISO 8601 with the offset Photos stores
    lat real,
    lon real,
    favorite integer,
    edited integer,
    screenshot integer,
    labels text,                          -- JSON list of Photos' own scene labels
    preview text,                         -- local preview file the analysis used
    score real,                           -- Vision aesthetics overallScore, -1..1
    utility integer,                      -- Vision isUtility
    blur real,                            -- Laplacian variance; low is blurry
    fp blob,                              -- Vision feature print, float32
    classes text,                         -- JSON {Vision classifier identifier: confidence} for vision.CLASSES
    emb blob,                             -- EmbeddingGemma 2 image embedding, float32 x 768 (junk photos only)
    faces integer,                        -- faces Vision found; NULL = not analysed for faces yet
    face_q real,                          -- weakest face's capture quality, 0..1
    pixels integer,                       -- original width x height
    burst_pick integer,                   -- 2 picked by you in Photos, 1 Photos' own key photo, 0 otherwise
    camera text,                          -- EXIF make + model; '' when the photo has none
    keywords text,                        -- JSON list of the photo's Photos keywords at the last scan
    albums text                           -- JSON list of the titles of the albums it is in at the last scan
);
create table if not exists decisions (
    uuid text not null,
    step text not null,
    grp text,
    choice text not null,                -- accept | reject
    run_id integer,                      -- set when an apply wrote it
    primary key (uuid, step)
);
create table if not exists dupe_labels (
    a text not null,
    b text not null,
    dist real not null,                  -- Vision feature print distance
    same integer,                        -- 1 same moment, 0 different, NULL not labelled yet
    primary key (a, b)
);
create table if not exists event_guesses (
    first text primary key,              -- first photo of the event; the event's photos are in uuids
    uuids text not null,                 -- JSON list
    result text not null                 -- JSON from events.judge: kind, name, place, said_city
);
create table if not exists pile_of (    -- table edits: photos moved to another event pile by a merge or a new event
    uuid text primary key,
    pile text not null
);
create table if not exists piles (       -- event piles the user named; a named pile becomes an album of that name
    pile text primary key,
    name text not null,
    applied_name text                    -- the album's name in Photos after the last apply
);
create table if not exists pile_members (  -- the photos of each pile you named or edited, when the piles were last built
    pile text not null,                  -- so a rebuild after a rescan can find the pile again by its photos
    uuid text not null,
    primary key (pile, uuid)
);
create table if not exists tag_edits (   -- keyword changes not yet written to Photos
    uuid text not null,
    keyword text not null,
    op text not null,                    -- add | remove
    primary key (uuid, keyword)
);
create table if not exists album_adds (  -- photos put in an album from the table, not yet written to Photos
    uuid text not null,
    album text not null,
    primary key (uuid, album)
);
create table if not exists place_edits ( -- the place you confirmed for a photo without GPS: it gets a pin there on Apply
    uuid text primary key,
    city text not null,
    country text not null,               -- ISO code
    lat real not null,                   -- GeoNames city centre
    lon real not null,
    exact integer not null default 0     -- 1: coordinates you typed, city is only the nearest one
);
create table if not exists kept (        -- piles you finished in the Grid's Events step (Keep); hidden there
    pile text primary key
);
create table if not exists album_removes ( -- photos taken out of an album from Sift (event albums, Sift's own additions);
    uuid text not null,                     -- kept after apply, so the photo isn't added back
    album text not null,
    primary key (uuid, album)
);
create table if not exists fav_edits (   -- photos to make favourites on Apply (Best-of step)
    uuid text primary key
);
create table if not exists edit_log (   -- undo for edits not yet applied: the rows each edit was about to change
    id integer primary key,
    label text not null,                 -- what the edit did, e.g. "Place of 3 photos"
    snaps text not null                  -- JSON [{table, keys, rows}] as they were before the edit
);
create table if not exists eval_runs (   -- Photos search results per query: the baseline before Sift's first metadata write, then later runs
    label text not null,                 -- baseline | after
    created text not null,
    query text not null,
    uuids text not null                  -- JSON list of the photos Photos found
);
create table if not exists settings (
    key text primary key,
    value text
);
create table if not exists runs (
    id integer primary key,
    step text not null,                  -- junk | duplicates | events | names | locations
    created text not null,
    undone text
);
create table if not exists journal (
    run_id integer not null references runs(id),
    uuid text not null,
    field text not null,                 -- keywords | title | location | album
    before text,
    after text
);
"""


def connect(path: Path) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.executescript(SCHEMA)
    cols = {r[1] for r in db.execute("pragma table_info(assets)")}
    for col, kind in (
        ("classes", "text"),
        ("emb", "blob"),
        ("faces", "integer"),
        ("face_q", "real"),
        ("pixels", "integer"),
        ("burst_pick", "integer"),
        ("camera", "text"),
        ("keywords", "text"),
        ("albums", "text"),
    ):  # state from before these columns existed
        if col not in cols:
            db.execute(f"alter table assets add column {col} {kind}")
    if "exact" not in {r[1] for r in db.execute("pragma table_info(place_edits)")}:
        db.execute("alter table place_edits add column exact integer not null default 0")
    return db

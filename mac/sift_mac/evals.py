"""Evals: your own searches, run through Photos' search before Sift writes metadata (the baseline) and after,
so you can see what the albums and keywords changed. Searches live in ~/.sift-mac/evals.toml."""

import json
import sqlite3
import tomllib
from datetime import UTC, datetime

from . import config, photos_app


def queries() -> list[str]:
    path = config.home() / "evals.toml"
    return tomllib.loads(path.read_text()).get("queries", []) if path.exists() else []


def has_baseline(db: sqlite3.Connection) -> bool:
    return db.execute("select 1 from eval_runs where label='baseline' limit 1").fetchone() is not None


def run(db: sqlite3.Connection, app=photos_app) -> list[dict]:
    """Run every search. The first run is the baseline; later runs are compared with it."""
    label = "after" if has_baseline(db) else "baseline"
    created = datetime.now(UTC).isoformat()
    base = {q: set(json.loads(u)) for q, u in db.execute("select query, uuids from eval_runs where label='baseline'")}
    out = []
    for q in queries():
        found = app.search(q)
        db.execute(
            "insert into eval_runs (label, created, query, uuids) values (?, ?, ?, ?)", (label, created, q, json.dumps(sorted(found)))
        )
        before = base.get(q, found if label == "baseline" else set())
        out.append({"query": q, "baseline": len(before), "now": len(found), "gained": len(found - before), "lost": len(before - found)})
    db.commit()
    return out

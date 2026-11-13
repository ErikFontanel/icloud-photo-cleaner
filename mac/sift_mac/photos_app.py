"""Writes through Photos.app's own AppleScript. Every write goes to the library Photos has open, so callers check it first."""

import subprocess
import time

TO_DELETE = "Sift – To Delete"  # same title as the iOS app (Sift/Model/DecisionStore.swift)
BATCH = 500  # reads (exists checks)
ADD_BATCH = 50  # Photos silently ignored some `add` commands of 500 photos on a 29k library; 50 landed at once


class WrongLibrary(Exception):
    pass


def osa(script: str, *args: str) -> str:
    """Run AppleScript with arguments passed as argv, so names and IDs need no quoting."""
    r = subprocess.run(["osascript", "-", *args], input=script, capture_output=True, text=True, timeout=600)
    if r.returncode:
        raise RuntimeError(f"osascript failed ({r.returncode}): {r.stderr.strip()}")
    return r.stdout.strip()


def _ids(uuids) -> str:
    return "\n".join(f"{u}/L0/001" for u in uuids)


def existing(uuids: list[str]) -> set[str]:
    """The photos among uuids that exist in the library Photos has open (deleted ones are gone from AppleScript)."""
    script = """on run argv
    tell application "Photos"
        set found to {}
        repeat with i in paragraphs of (item 1 of argv)
            if exists media item id (i as text) then set end of found to (i as text)
        end repeat
        set AppleScript's text item delimiters to linefeed
        return found as text
    end tell
    end run"""
    found = set()
    for start in range(0, len(uuids), BATCH):
        found |= {line.split("/")[0] for line in osa(script, _ids(uuids[start : start + BATCH])).splitlines() if line}
    return found


def check_library(uuids: list[str], found: set[str] | None = None) -> set[str]:
    """Refuse unless Photos is open on the library these photos came from. Returns the ones that still exist.

    A few may have been deleted since the scan; fewer than 80% present means another library is open.
    """
    found = existing(uuids) if found is None else found
    if len(found) < 0.8 * len(uuids):
        raise WrongLibrary(
            f"Photos has another library open: only {len(found)} of {len(uuids)} photos found. Open the library you scanned and try again."
        )
    return found


def album_members(name: str = TO_DELETE) -> set[str]:
    out = osa(
        """on run argv
        tell application "Photos"
            if not (exists album (item 1 of argv)) then return ""
            set AppleScript's text item delimiters to linefeed
            return (id of every media item of album (item 1 of argv)) as text
        end tell
        end run""",
        name,
    )
    return {line.split("/")[0] for line in out.splitlines() if line}


def add_to_album(uuids: list[str], name: str = TO_DELETE) -> set[str]:
    """Add photos in batches and return the ones Photos refused.

    Photos drops a whole `add` without an error when one photo in it can't go into an album (a Shared Album photo,
    2026-11-12). So after each batch it waits for the photos to show; any still missing are added one at a time.
    """
    script = """on run argv
    tell application "Photos"
        if not (exists album (item 1 of argv)) then make new album named (item 1 of argv)
        set items_ to {}
        repeat with i in paragraphs of (item 2 of argv)
            set end of items_ to media item id (i as text)
        end repeat
        add items_ to album (item 1 of argv)
    end tell
    end run"""
    refused = set()
    for start in range(0, len(uuids), ADD_BATCH):
        batch = set(uuids[start : start + ADD_BATCH])
        osa(script, name, _ids(sorted(batch)))
        missing = wait_for_members(batch, name, timeout=10)
        for u in sorted(missing):
            osa(script, name, _ids([u]))
        refused |= wait_for_members(missing, name, timeout=10) if missing else set()
    return refused


def wait_for_members(expected: set[str], name: str = TO_DELETE, timeout: float = 10) -> set[str]:
    """Photos may apply an `add` a moment after accepting it. Poll until all expected photos show; return those that never did."""
    deadline = time.monotonic() + timeout
    while True:
        missing = expected - album_members(name)
        if not missing or time.monotonic() > deadline:
            return missing
        time.sleep(1)


def rebuild_album_without(remove: set[str], name: str = TO_DELETE) -> int:
    """Photos' AppleScript can't remove album members, so make a new album with the rest and swap it in. Returns photos removed."""
    members = album_members(name)
    gone = members & remove
    if not gone:
        return 0
    keep = sorted(members - remove)
    if not keep and name != TO_DELETE:  # an event album this run created: nothing left, so it goes
        osa('on run argv\ntell application "Photos" to delete album (item 1 of argv)\nend run', name)
        return len(gone)
    temp = name + " (sift-mac rebuild)"
    osa('on run argv\ntell application "Photos" to make new album named (item 1 of argv)\nend run', temp)
    if keep:
        add_to_album(keep, temp)
    osa(
        """on run argv
        tell application "Photos"
            delete album (item 1 of argv)
            set name of album (item 2 of argv) to (item 1 of argv)
        end tell
        end run""",
        name,
        temp,
    )
    return len(gone)


def get_keywords(uuids: list[str]) -> dict[str, list[str]]:
    """Each photo's current keywords, read from Photos (not the scan) right before they are changed."""
    script = """on run argv
    tell application "Photos"
        set out to {}
        set AppleScript's text item delimiters to tab
        repeat with i in paragraphs of (item 1 of argv)
            set k to keywords of media item id (i as text)
            if k is missing value then set k to {}
            set end of out to (i as text) & tab & (k as text)
        end repeat
        set AppleScript's text item delimiters to linefeed
        return out as text
    end tell
    end run"""
    out = {}
    for start in range(0, len(uuids), BATCH):
        for line in osa(script, _ids(uuids[start : start + BATCH])).splitlines():
            ident, *kws = line.split("\t")
            out[ident.split("/")[0]] = [k for k in kws if k]
    return out


def set_keywords(keywords: dict[str, list[str]]) -> None:
    """Set each photo's keywords to exactly the given list. Keywords never contain tabs or line breaks."""
    script = """on run argv
    tell application "Photos"
        set idLines to paragraphs of (item 1 of argv) -- names that aren't Photos terms ("lists" reads as every list)
        set kwLines to paragraphs of (item 2 of argv)
        set AppleScript's text item delimiters to tab
        repeat with n from 1 to count of idLines
            set k to {}
            set ws to text items of (item n of kwLines)
            repeat with j from 2 to count of ws -- item 1 is the "k" marker that keeps an empty list's line non-empty
                if (item j of ws as text) is not "" then set end of k to (item j of ws as text)
            end repeat
            set keywords of media item id (item n of idLines) to k
        end repeat
    end tell
    end run"""
    items = sorted(keywords.items())
    for start in range(0, len(items), BATCH):
        part = items[start : start + BATCH]
        osa(script, _ids([u for u, _ in part]), "\n".join("\t".join(["k", *k]) for _, k in part))


def rename_album(old: str, new: str) -> None:
    osa('on run argv\ntell application "Photos" to set name of album (item 1 of argv) to (item 2 of argv)\nend run', old, new)


def search(query: str) -> set[str]:
    """Photos' own search, as typed in its search field, on the library Photos has open."""
    out = osa(
        """on run argv
    tell application "Photos"
        set found to {}
        repeat with m in (search for (item 1 of argv)) -- a plain list, so each id is read one by one
            set end of found to id of m
        end repeat
        set AppleScript's text item delimiters to linefeed
        return found as text
    end tell
    end run""",
        query,
    )
    return {line.split("/")[0] for line in out.splitlines() if line}


# Coordinates cross AppleScript as integer micro-degrees: real numbers turn into "52,1" on a Dutch system.
def get_locations(uuids: list[str]) -> dict[str, tuple[float, float] | None]:
    """Each photo's location as Photos has it now; None when it has none."""
    script = """on run argv
    tell application "Photos"
        set out to {}
        repeat with i in paragraphs of (item 1 of argv)
            set l to location of media item id (i as text)
            if l is missing value or item 1 of l is missing value then
                set end of out to (i as text) & tab & "-"
            else
                set end of out to (i as text) & tab & ((round ((item 1 of l) * 1000000)) as text) & tab & ((round ((item 2 of l) * 1000000)) as text)
            end if
        end repeat
        set AppleScript's text item delimiters to linefeed
        return out as text
    end tell
    end run"""
    out = {}
    for start in range(0, len(uuids), BATCH):
        for line in osa(script, _ids(uuids[start : start + BATCH])).splitlines():
            ident, *ll = line.split("\t")
            out[ident.split("/")[0]] = None if ll == ["-"] else (int(ll[0]) / 1e6, int(ll[1]) / 1e6)
    return out


def set_locations(locations: dict[str, tuple[float, float] | None]) -> None:
    """Set each photo's location; None clears it (undo of a pin on a photo that had none)."""
    script = """on run argv
    tell application "Photos"
        set idLines to paragraphs of (item 1 of argv)
        set llLines to paragraphs of (item 2 of argv)
        set AppleScript's text item delimiters to tab
        repeat with n from 1 to count of idLines
            set ll to text items of (item n of llLines)
            if (item 1 of ll) is "-" then
                set location of media item id (item n of idLines) to {missing value, missing value}
            else
                set location of media item id (item n of idLines) to {((item 1 of ll) as integer) / 1000000, ((item 2 of ll) as integer) / 1000000}
            end if
        end repeat
    end tell
    end run"""
    items = sorted(locations.items())
    for start in range(0, len(items), BATCH):
        part = items[start : start + BATCH]
        osa(
            script,
            _ids([u for u, _ in part]),
            "\n".join("-" if v is None else f"{round(v[0] * 1e6)}\t{round(v[1] * 1e6)}" for _, v in part),
        )


def get_favorites(uuids: list[str]) -> dict[str, bool]:
    script = """on run argv
    tell application "Photos"
        set out to {}
        repeat with i in paragraphs of (item 1 of argv)
            set end of out to (i as text) & tab & ((favorite of media item id (i as text)) as text)
        end repeat
        set AppleScript's text item delimiters to linefeed
        return out as text
    end tell
    end run"""
    out = {}
    for start in range(0, len(uuids), BATCH):
        for line in osa(script, _ids(uuids[start : start + BATCH])).splitlines():
            ident, fav = line.split("\t")
            out[ident.split("/")[0]] = fav == "true"
    return out


def set_favorites(favorites: dict[str, bool]) -> None:
    script = """on run argv
    tell application "Photos"
        set idLines to paragraphs of (item 1 of argv)
        set fLines to paragraphs of (item 2 of argv)
        repeat with n from 1 to count of idLines
            set favorite of media item id (item n of idLines) to ((item n of fLines) is "1")
        end repeat
    end tell
    end run"""
    items = sorted(favorites.items())
    for start in range(0, len(items), BATCH):
        part = items[start : start + BATCH]
        osa(script, _ids([u for u, _ in part]), "\n".join("1" if f else "0" for _, f in part))

# Junk grid

The Mac review page's first tab groups likely junk (screenshots, documents and receipts, utility shots, blurry and low-quality photos). The user clicks the photos they want to keep, then marks the rest as junk. Nothing is written to Photos until `Apply to Photos`.

## Sub-features

- `junk-sections`: section chips with counts (`Blurry · 1`).
- `junk-keep`: clicking a photo toggles keep; the primary button text updates (`Mark 1 as junk, keep 0`).
- `junk-mark`: marking adds the photos to the pending To Delete list.
- `junk-apply`: `Apply to Photos` adds the marked photos to the album in Photos.app.

## How to get to it (user POV)

- Open `http://127.0.0.1:8766/`, tab `1 Junk`.

## Driving it with Chrome

Preconditions:

- `mac.sh doctor` is `UP`, and `pending.delete` is `0`.

- **See the section.** Navigate to the page and choose the chip `Blurry · 1`. The fixture `blurry.jpg` shows with a `junk` badge.
- **Mark.** Choose `Mark 1 as junk, keep 0`. The header changes from `No pending changes.` to a pending count.
- **Second view.** Run `mac.sh doctor`. `state` shows `"pending": {"delete": 1, ...}`. Then run `mac.sh shot junk-marked /` for the screenshot.
- **Apply (only with Photos.app open on "Sift Test").** Choose `Apply to Photos`. In Photos.app, the "Sift – To Delete" album holds the photo, and the photo is still in the library.

## Gotchas

- `Apply to Photos` writes to whichever library Photos.app has open. See SKILL.md.
- `Rescan` scans the system library into the scratch state. Restart the page instead.

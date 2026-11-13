# Photo table

`/table` lays every photo out on a WebGL canvas as Grid, Pile, Events, Visual or Time. The user drops photos on the To Delete zone or uses the eraser, and names events, tags, places and album additions. All edits stay pending until applied.

## Sub-features

- `table-layouts`: buttons `Grid 1` … `Time 5` (keys 1–5) re-arrange the photos.
- `table-delete`: drag to the `To Delete · drop, ⌫ or eraser` zone, `⌫` on a selection, or `Eraser E`.
- `table-events`: the Events layout heads each event with a place, distance from home and date (`… · 1807 km from home · 14 Jun 2024 · 15`).
- `table-place`: input `aria-label="Place for the selected photos"` (key L) takes a city or coordinates.
- `table-tags-albums`: inputs `Add a tag` (T) and `Add to an album` (A).
- `table-undo`: `Undo ⌘Z`.

## How to get to it (user POV)

- Open `http://127.0.0.1:8766/table`.

## Driving it with Chrome

Preconditions:

- `mac.sh doctor` is `UP`. The table needs WebGL2: real Chrome, or `mac.sh shot` (software WebGL).

- **Layouts.** Press `3`. Event headings appear with their home distance, which comes from `SIFT_HOMES` in `.env`. Run `mac.sh shot table-events /table` for the default view.
- **Mark for deletion.** Select a photo, press `⌫`. The red counter in the drop zone goes from `0` to `1`. Second view: `mac.sh doctor` shows the uuid under `marked`.
- **Place.** Select photos without GPS, press `L`, type `Kyoto, JP` and press Enter. Second view: `sqlite3 build/verify/.mac/home/state.sqlite "select city, country from place_edits"`.
- **Undo.** Press `⌘Z`. The counter or place reverts, and `doctor` agrees.

## Gotchas

- `This browser has no WebGL2.` in a screenshot means the browser lacked WebGL, not that the app broke.
- `?demo=N` draws generated tiles instead of the library. It's useful for speed checks, but proves nothing about real data.
- With an empty `SIFT_HOMES`, no event says "km from home". That is expected.

# Review a month

The user opens a month and decides photo by photo: swipe left or tap Delete to mark it, swipe right or tap Keep to keep it. They can undo, step back and change an earlier decision. Marked photos go to the "Sift – To Delete" album.

## Sub-features

- `review-swipe`: swipe left/right decides and advances.
- `review-buttons`: Delete/Keep buttons decide and advance.
- `review-undo`: toolbar Undo (or shake) reverts the last decision and returns to that photo.
- `review-previous`: Previous steps back; deciding again flips the earlier decision.
- `review-progress`: subtitle `"<i> of <n> · <p>%"` and the month row's `"<p>% sorted, <n> items"`.

## How to get to it (user POV)

- Months list → tap a month row (e.g. `October 2026`).
- Swipe the photo card, or tap `Delete` / `Keep` in the bottom bar.
- Navigation bar `Undo`; `Previous` button; back to the list.

## Driving it with XCUITest

Preconditions:

- Simulator app built after the change (`ios.sh doctor`).

- **Full flow.** Run `.claude/skills/verify/scripts/ios.sh test testSwipeUndoAndFlip`. Exit 0 proves swipe, fast double swipe, undo, previous, flip and the row value on the months list.
- **Screens.** Run `.claude/skills/verify/scripts/ios.sh screens light` (and `dark`). `2-review.png` shows the card and bottom bar, and `3-review-after-decisions.png` shows the subtitle after two decisions.
- **New path.** Add a test that opens `October 2026`, performs the action and calls `snap()` before and after. Assert the subtitle and the month row value.

## Gotchas

- The simulator library may hold more than the samples, so read the month size from the subtitle and don't hard-code it.
- A decision only shows on the months list after you go back. The row value is the second view that proves persistence.

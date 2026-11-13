# Month summary

When the last photo of a month is decided, a sheet titled `"<Month> Is Sorted"` shows the To Delete count, the space it would free, and `Open Photos`. Closing it and changing a decision must not bring it back.

## Sub-features

- `done-sheet`: sheet appears after the last decision.
- `done-to-free`: "To Free" fills in with a byte size (not `–`).
- `done-again`: `Review Again from the Start` reopens the month without re-showing the sheet.

## How to get to it (user POV)

- Decide every photo of a month (the samples' smallest is `December 2025`, 5 photos).

## Driving it with XCUITest

Preconditions:

- As in [review](./review.md).

- **Flow.** Run `.claude/skills/verify/scripts/ios.sh test testFinishingAMonthShowsSummary`. Exit 0 proves the sheet, the To Free size and that the sheet does not come back.
- **Screen.** `4-month-done.png` from `ios.sh screens` shows the sheet for `September 2026`.

## Gotchas

- The toolbar hides under the sheet. Stop tapping `Keep` once it is gone, or the test taps behind the sheet.

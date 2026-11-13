# Sift verification map

The maintained list of user-facing features and how to prove each one. Read [`../SKILL.md`](../SKILL.md) for launch, doctor and teardown. Then use the feature file as the recipe.

## Baseline preconditions

- iOS: `ios.sh doctor` shows the simulator, and the app was built after your change. UI tests seed the sample months and empty the To Delete album at launch.
- Mac: `mac.sh doctor` reports `UP` on port 8766 with 17 analysed assets from "Sift Test".
- Never drive an instance this run did not start (the user's own review page runs on 8765).

## Driving conventions

- iOS handles are accessibility labels: `Keep`, `Delete`, `Undo`, `Previous`, `Continue`, month rows by `"<Month> <Year>"`, and the subtitle `"<i> of <n> · <p>%"`.
- Mac handles are visible button text and `aria-label`s, quoted literally in each recipe.
- Restart the Mac page (`mac.sh stop && mac.sh start`) to return to a clean state.

## Proof and skip reporting

- Each artifact names the feature ID and the entry point it proves.
- A path you could not reach is reported with the unmet precondition, never covered by a different path.

## Features

- [Review a month](./review.md): iOS swipe and button review, undo, previous, flip a decision.
- [Month summary](./month-done.md): iOS done sheet, "To Free", review again.
- [Photo access](./access.md): iOS permission screen and the system alert.
- [Junk grid](./mac-junk.md): Mac page junk sections, keep by click, mark as junk.
- [Photo table](./mac-table.md): Mac table layouts, To Delete drop zone, places and tags.

---
name: verify
description: Drive the real Sift apps and capture proof. Use for the iOS app on the simulator (months list, swipe review, month summary) or the Mac companion's review page in a browser (junk grid, photo table), after a change to either app, or when the user asks to verify, run or screenshot Sift.
---

# Verify Sift

Prove a change in the running app the way a user meets it, and leave evidence in `build/verify/` (gitignored, never deleted by cleanup). Unit tests and hooks prove the code; this skill proves the product.

Pick the surface the change touches. Then read the matching file in [`features/`](features/README.md) and follow its recipe. Both helpers live in `.claude/skills/verify/scripts/` and print their usage when run without arguments.

## iOS app (simulator, XCUITest)

The driver is XCUITest: `SiftUITests/ReviewFlowUITests.swift` launches the app with `-seed-sample-library -empty-deletion-album`, accepts the photo permission alert and adds 31 dated sample photos (Oct, Sep, Aug 2026 and Dec 2025). Simulator: `SIFT_SIM`, default `iPhone 17 Pro`.

- **Launch + drive:** `.claude/skills/verify/scripts/ios.sh screens light` (or `dark`). This builds, runs `testCaptureScreens` and exports 4 screenshots (months, review, after decisions, month done) to `build/verify/ios-<stamp>-light-testCaptureScreens/`. It takes about 3 minutes.
- **One flow:** `.claude/skills/verify/scripts/ios.sh test <TestName>`, e.g. `testSwipeUndoAndFlip`. For a path no test covers, add a test method to `ReviewFlowUITests` that drives it through accessible labels (`app.buttons["Keep"]`) and calls `snap("<name>")` at each step. Then run it the same way and keep the test when it proves new behavior.
- **Look now:** `.claude/skills/verify/scripts/ios.sh shot <name>` saves the booted simulator's screen.
- **Doctor:** `.claude/skills/verify/scripts/ios.sh doctor` shows the simulator state, the built bundle ID with its build time, and whether the app is installed. A build time older than your change means the app under test is stale.
- **Teardown:** nothing to stop. Each `xcodebuild test` run ends its own app. Leave the simulator booted; it is shared with `scripts/test.sh`.

## Mac companion (review page, browser)

The page runs from its own `SIFT_HOME` under `build/verify/.mac/`. It contains the "Sift Test" Photos library (`~/Pictures/Sift Test.photoslibrary`), scanned read-only. It runs on port 8766 (`SIFT_VERIFY_PORT`), so it never touches the user's own state or their instance on 8765.

- **Launch:** `.claude/skills/verify/scripts/mac.sh start`. It is ready when it prints `ready: http://127.0.0.1:8766 (pid N)`.
- **Doctor:** `.claude/skills/verify/scripts/mac.sh doctor` checks that the PID it started owns the port. It also prints the page state (`pending`, `marked`, `tags`) and the asset count in the scratch database. Run it first whenever the page acts odd.
- **Drive:** use the Chrome tools (`mcp__claude-in-chrome__*`; load the `claude-in-chrome` skill) on `http://127.0.0.1:8766/` (junk grid) or `/table` (photo table). Find controls by their visible text or `aria-label` (listed per feature).
- **Regression checks without the extension:** `.claude/skills/verify/scripts/web-check.mjs` drives headless Chrome over the DevTools protocol with real key and mouse events. It covers quick look and Space, typing in the tag field, keys during and after a pointer gesture, a cancelled gesture, and console errors. It prints PASS or FAIL per check, saves screenshots to `build/verify/web-<stamp>/` and exits 1 on any FAIL. Extend it when you change keyboard or pointer behaviour on the table.
- **Screenshot:** `.claude/skills/verify/scripts/mac.sh shot <name> [/path]` uses headless Chrome with software WebGL (the table needs WebGL2) and saves to `build/verify/mac-<stamp>-<name>.png`. It loads the page fresh, so it shows stored state, not clicks made in another browser.
- **Teardown:** `.claude/skills/verify/scripts/mac.sh stop` sends SIGTERM to the saved PID and removes `build/verify/.mac`. Run it after every attempt, including failed ones.

## Evidence standard

- Drive the user path: buttons, swipes and keys. Avoid test-only endpoints and setters. The launch arguments above only seed data.
- Capture the action and its result: a screenshot before and after, plus the test name and its exit code.
- Check side effects through a second view. On iOS, go back to the months list and read the row value (`"N% sorted, M items"`). On the Mac, read `mac.sh doctor` (`pending`, `marked`) or the scratch database: `sqlite3 build/verify/.mac/home/state.sqlite`.
- Report each check as **verified** (with its artifact path) or **not verified** (with the reason). A screenshot of the wrong state counts as not verified.

## Gotchas

- **Sift never deletes photos.** Proof of a "delete" is the photo in the "Sift – To Delete" album and the count in the UI, never a photo gone from the library.
- **Apply to Photos** writes to whatever library Photos.app has open. Click it only with Photos.app open on "Sift Test". `photos_app` refuses when fewer than 80% of the scanned photos are present, but don't rely on that guard.
- The page's **Rescan** scans the system library, not "Sift Test". Restart with `mac.sh stop && mac.sh start` instead.
- `mac.sh start` reuses the user's GeoNames data (`~/.sift-mac/geonames`). If it is missing, the start prints the one-time `sift-mac setup` command.

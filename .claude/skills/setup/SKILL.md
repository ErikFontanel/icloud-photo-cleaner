---
name: setup
description: Install everything Sift needs on this Mac (the Mac companion, and the iOS app if wanted), and walk the user through the steps only they can do.
disable-model-invocation: true
---

# Set up Sift

`scripts/setup.sh` (in this skill) does every step that can be scripted, and skips what is already there. Its `check` prints one line per item:

- `ok`: done.
- `todo`: `setup.sh mac` or `setup.sh ios` installs it.
- `user`: only the user can do it. The line carries the command or the settings pane.

You run everything else yourself and walk the user through only the `user` lines. For a `user` line:

- A `sudo` command or an interactive installer (Homebrew): ask the user to type it with the `!` prefix, so it runs in this session and they can enter their password.
- A settings pane or the App Store: open it yourself with `open` (`open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"` for Full Disk Access, the `macappstore://` link the line gives for Xcode). Then tell the user what to click.
- A dialog (Command Line Tools): run the command yourself, then tell the user to click Install.

After each fix, run `check` again. A step is done when its lines read `ok`.

## 1. Preflight

1. Ask the user with AskUserQuestion: "Set up the iOS app too?" Explain that it needs Xcode (about 10 GB from the App Store) and an iOS simulator runtime (several GB). The Mac companion is always set up, because it also installs the git hooks.
2. Run `.claude/skills/setup/scripts/setup.sh check` (add `ios` if they said yes). Show the user a short summary: what is already there, what you will install, what they must do.
3. Resolve the `user` lines for Homebrew and Command Line Tools before step 2. Every install needs them.

## 2. Install the Mac companion

Run `.claude/skills/setup/scripts/setup.sh mac` with `run_in_background`. The first run downloads several GB (Python packages with torch, two Ollama models, an MLX model and GeoNames), so it can take a long time. While it runs, do step 3.

When it fails, read the error, fix the cause (a `user` step, a network error), and run it again.

## 3. Fill in `.env`

The script copies `.env.example` to `.env`. Ask the user for:

- `SIFT_HOMES`: the cities they lived in since their first photo, with the date they moved away. Look up the coordinates yourself and write `city,lat,lon,until;...` in date order. The last home has no `until`.
- iOS only: `SIFT_BUNDLE_ID_PREFIX`, a reverse-DNS prefix they own (for example `com.yourname`). `com.example` works only in the simulator.
- iOS on an iPhone only: `SIFT_DEVELOPMENT_TEAM`. They add their Apple ID in Xcode > Settings > Accounts. The team ID is the 10 characters in the team's details. Leave it empty if they will only use the simulator.

These values are private. Write them only to `.env`, never to a file in git.

## 4. Install the iOS app (if wanted)

1. Run `check ios` and resolve its `user` lines in order: install Xcode, open it once, `xcode-select`, license, first launch.
2. Run `.claude/skills/setup/scripts/setup.sh ios` with `run_in_background` (the iOS runtime download is large).
3. To put the app on their iPhone, walk them through "Install on your iPhone" in `README.md`.

## 5. Grant Photos access

`check` reports Full Disk Access as a `user` line when the terminal cannot read the Photos database. Open the pane, tell the user to turn on their terminal app and restart it. The first **Apply to Photos** also asks to let the terminal control Photos. Tell the user to click OK.

## Done when

- `setup.sh check` (with `ios` if chosen) prints no `todo` or `user` line and exits 0. The Full Disk Access line is the exception if the user restarts their terminal later; say so.
- `cd mac && uv run pytest -q -m "not photos"` passes.
- iOS: `scripts/test.sh -only-testing:SiftTests` passes.

Report what you installed, what the user did, and how to start: `cd mac && uv run sift-mac scan`, then `uv run sift-mac review`.

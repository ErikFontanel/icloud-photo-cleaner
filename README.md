> [!NOTE]
> Tell your agent to run /setup to use

# Sift

Sift sorts your photo library one photo at a time. Swipe left to mark a photo for deletion, swipe right to keep it. Sift adds marked photos to the **Sift – To Delete** album in Photos. Sift never deletes photos: you delete them yourself from that album.

Requirements: Xcode 26.1 or later, XcodeGen (`brew install xcodegen`), an iPhone with iOS 26. For development: pnpm and uv.

## Getting started

Run `/setup` in Claude Code, or run the setup script yourself:

```sh
.claude/skills/setup/scripts/setup.sh check   # one line per item: ok, todo or user (a step only you can do)
.claude/skills/setup/scripts/setup.sh mac     # installs the Mac companion; the first run downloads several GB
```

Then set `SIFT_HOMES` in `.env` and give your terminal app Full Disk Access (**System Settings > Privacy & Security > Full Disk Access**), so it can read the Photos library.

### Open the review page

The Mac companion is a web page that runs on your Mac. Start it:

```sh
cd mac && uv run sift-mac review   # add --port 9000 to use another port
```

Then open <http://127.0.0.1:8765> in your browser. The server stops when you press Ctrl+C.

- `/` is the grid: junk photos and duplicates, one step at a time. When a step is empty, click **Rescan for new photos** to analyse the photos added since the last scan.
- `/table` is the photo table, where you sort photos into events and edit names, places, tags and albums.
- **Apply to Photos** adds your decisions to the "Sift – To Delete" album. The first time, macOS asks to let your terminal control Photos. Click **OK**.

### Change the review page

To work on the page with hot reload, keep `sift-mac review` running and start Vite in a second terminal:

```sh
pnpm --dir mac/web dev   # proxies /api, /thumb and /preview to the running review server
```

`sift-mac review` serves the last build, so run `pnpm --dir mac/web build` before you use it without Vite.

### CLI

The page covers the daily work. The CLI (`cd mac`, then `uv run sift-mac <command>`) has the other steps:

| Command | What it does |
| --- | --- |
| `scan` | Analyses photos added or changed since the last scan. Read-only. The page's Rescan button does the same. |
| `events` | Finds events. The local model judges the events without GPS. |
| `embed` | Groups undecided junk photos by content. |
| `bench` | Scores the detectors against your labels. |
| `evals` | Runs your searches (`~/.sift-mac/evals.toml`) through Photos' search. |
| `setup` | Downloads the models and GeoNames data. The only step that uses the network. |

If you move or rename the repo folder, run `setup.sh mac` again. It makes `mac/.venv` again, because a moved venv does not run.

## Build and test

```sh
cp .env.example .env       # then set your bundle ID prefix, team ID and home locations
pnpm install               # Biome, the lefthook git hooks and the Mac review page
pnpm --dir mac/web build   # builds the Mac review page into mac/sift_mac/web/
scripts/generate.sh        # makes Sift.xcodeproj from project.yml and .env
scripts/test.sh            # unit tests + UI tests on the iPhone 17 Pro simulator
cd mac && uv run pytest -m "not photos"   # Mac companion tests
```

The UI tests accept the photo permission alert and add 31 dated sample photos to the simulator on the first run.

The simulator app is at `build/Build/Products/Debug-iphonesimulator/Sift.app` after a build or test run.

## Install on your iPhone (free Apple ID)

1. In Xcode, open **Settings > Accounts** and add your Apple ID.
2. Open `Sift.xcodeproj`. Select the **Sift** target > **Signing & Capabilities** > **Team** and select your Personal Team.
   To keep the team after you run `scripts/generate.sh` again, put your team ID in `SIFT_DEVELOPMENT_TEAM` in `.env`.
3. On the iPhone, turn on **Settings > Privacy & Security > Developer Mode** and restart the phone.
4. Connect the iPhone, select it as the run destination, and press **Run**.
5. On the iPhone, open **Settings > General > VPN & Device Management**, select your Apple ID and tap **Trust**.

With a free Apple ID the app stops opening after 7 days. Connect the iPhone and press **Run** again. Your decisions stay, because Xcode updates the app in place.

## How it works

- `Sift/Library`: reads the library with PhotoKit, groups it by month, and syncs the To Delete album.
- `Sift/Model/DecisionStore.swift`: stores keep and delete decisions in SwiftData and registers each one with the system undo manager (toolbar Undo and shake to undo).
- `Sift/Features`: the Months list, the Review screen with the swipe card, and the permission screen.
- `scripts/no-delete.sh` stops the build, a commit or an agent edit if the code calls a photo delete API.
- If you remove a photo from the album in Photos, Sift shows it as not sorted again. If you delete the album, Sift makes it again on the next launch.

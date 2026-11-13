# Sift

Two apps that sort a photo library without deleting anything:

- `Sift/`: iOS app (Swift 6, SwiftUI, PhotoKit, SwiftData). `project.yml` defines the Xcode project.
- `mac/`: Mac companion (Python with `uv`, a local web UI in `mac/sift_mac/web/`, a Swift helper in `mac/helper/`). It reads Photos.app with osxphotos and writes through AppleScript.

## Hard rules

- **Sift never deletes photos.** Both apps add photos to the "Sift – To Delete" album; the user deletes them in Photos. `scripts/no-delete.sh` enforces this in the Xcode build, the commit hook and the edit hook. Deleting an album is fine.
- **Private values live in `.env`** (bundle ID prefix, team ID, home locations); `.env.example` lists every key. Code, tests and docs use neutral examples (Lyon, Lisbon, Kyoto, `com.example`). The pre-commit hook blocks any `.env` value.
- **Edit `project.yml`, then run `scripts/generate.sh`.** `Sift.xcodeproj` is generated and not in git; plain `xcodegen generate` misses the `.env` values.
- **Python runs through `uv`** (`uv run ...` in `mac/`).

## Checks

Edits are formatted and linted automatically (`.claude/hooks/`): swift-format for Swift, ruff for Python, Biome for the web UI. Fix what the hook reports before moving on. Commits run `lefthook.yml`; push runs the unit tests. Use `LEFTHOOK=0` only when the user says so.

| Change | Prove it with |
| --- | --- |
| `mac/` Python | `cd mac && uv run pytest -q -m "not photos"` (seconds) |
| `Sift/` logic | `scripts/test.sh -only-testing:SiftTests` |
| `Sift/` UI | `scripts/test.sh` (simulator `SIFT_SIM`, default iPhone 17 Pro; seeds sample photos) |
| Photos.app writes | `uv run pytest -m photos`, with Photos.app open on the "Sift Test" library (the tests refuse a library over 100 items) |

To prove a change in the running app (simulator or the Mac review page), use the `verify` skill.

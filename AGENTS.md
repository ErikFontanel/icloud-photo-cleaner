# Sift

Two apps that sort a photo library without deleting anything:

- `Sift/`: iOS app (Swift 6, SwiftUI, PhotoKit, SwiftData). `project.yml` defines the Xcode project.
- `mac/`: Mac companion (Python with `uv`, a local web UI: React, Vite and shadcn/ui source in `mac/web/`, built into `mac/sift_mac/web/` by `pnpm --dir mac/web build`, a Swift helper in `mac/helper/`). It reads Photos.app with osxphotos and writes through AppleScript.

## Hard rules

- **Sift never deletes photos.** Both apps add photos to the "Sift – To Delete" album; the user deletes them in Photos. `scripts/no-delete.sh` enforces this in the Xcode build, the commit hook and the edit hook. Deleting an album is fine.
- **Private values live in `.env`** (bundle ID prefix, team ID, home locations); `.env.example` lists every key. Code, tests and docs use neutral examples (Lyon, Lisbon, Kyoto, `com.example`). The pre-commit hook blocks any `.env` value.
- **Edit `project.yml`, then run `scripts/generate.sh`.** `Sift.xcodeproj` is generated and not in git; plain `xcodegen generate` misses the `.env` values.
- **Python runs through `uv`** (`uv run ...` in `mac/`).

## Web UI components

- Use shadcn/ui first: `mac/web/src/components/ui/` comes from `npx shadcn@latest add <name>` (run in `mac/web`); don't edit it by hand. Write a component only where shadcn has none.
- One component per job, shared by the Grid and the table: `PageHeader` (navigation), `ApplyBar` (Apply with confirm and progress), `ConfirmButton`, `ActionButton` (spinner, errors as toasts), and `meta/PhotoMeta` with `EventName` for every name, place, tag and album edit.
- Edits save on Enter or the check button; results and errors are Sonner toasts.

## State machines

Change these in one place, and test each transition there:

- iOS review screen: `ReviewSession` (`Sift/Features/Review/ReviewSession.swift`) owns which photo is up (reviewing, summary, sorted). `ReviewView` only animates it.
- Mac writes: one operation slot in `server.py` (`claim`/`operation`). Scan, apply and undo take it; a second one gets HTTP 409.
- Mac table build: `table.py` writes a build's result only if no newer build started, and a failed build retries on the next request.
- Web table: the pointer `mode` in `mac/web/src/table/engine.js` gates the keyboard; no key changes selection, layout or undo during a gesture. The engine owns the canvas and publishes HUD state through `hud.set`; React (`table/app.tsx`) only draws it.

## Checks

Edits are formatted and linted automatically (`.claude/hooks/`): swift-format for Swift, ruff for Python, Biome for the web UI. Fix what the hook reports before moving on. Commits run `lefthook.yml`; push runs the unit tests. Use `LEFTHOOK=0` only when the user says so.

| Change | Prove it with |
| --- | --- |
| `mac/` Python | `cd mac && uv run pytest -q -m "not photos"` (seconds) |
| `Sift/` logic | `scripts/test.sh -only-testing:SiftTests` |
| `Sift/` UI | `scripts/test.sh` (simulator `SIFT_SIM`, default iPhone 17 Pro; seeds sample photos) |
| `mac/web/` UI | `pnpm --dir mac/web build` (typechecks), then `.claude/skills/verify/scripts/web-check.mjs` |
| Photos.app writes | `uv run pytest -m photos`, with Photos.app open on the "Sift Test" library (the tests refuse a library over 100 items) |

To prove a change in the running app (simulator or the Mac review page), use the `verify` skill.

# Sift

Sift sorts your photo library one photo at a time. Swipe left to mark a photo for deletion, swipe right to keep it. Sift adds marked photos to the **Sift – To Delete** album in Photos. Sift never deletes photos: you delete them yourself from that album.

Requirements: Xcode 26.1 or later, XcodeGen (`brew install xcodegen`), an iPhone with iOS 26. For development: pnpm and uv.

## Build and test

```sh
cp .env.example .env       # then set your bundle ID prefix, team ID and home locations
pnpm install               # Biome and the lefthook git hooks
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

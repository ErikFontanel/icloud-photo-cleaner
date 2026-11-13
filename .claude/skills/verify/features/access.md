# Photo access

On first launch Sift explains why it needs the photo library, and `Continue` brings up the system permission alert. With limited or denied access the app shows how to change it in Settings.

## Sub-features

- `access-intro`: explanation screen with `Continue`.
- `access-alert`: system alert `Allow Full Access`.
- `access-denied`: guidance when access is not full.

## How to get to it (user POV)

- First launch after install, or after resetting permissions.

## Driving it with XCUITest

Preconditions:

- Reset permissions: `xcrun simctl privacy <UDID> reset photos <bundle id>` (UDID and bundle ID from `ios.sh doctor`).

- **Grant.** Run any UI test, e.g. `ios.sh test testCaptureScreens`. Its `launch()` taps `Continue` and the springboard's `Allow Full Access`. Add a `snap("0-access")` before `Continue` to capture the screen.
- **Denied.** Add a test that taps `Don't Allow` on the springboard alert and snaps the result.

## Gotchas

- Once permission is granted, the intro never shows again until you reset it. A run without the reset proves nothing about this screen.
- Resetting permissions also makes the next normal UI test go through the alert. That works, but it is slower.

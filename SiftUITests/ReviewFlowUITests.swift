import XCTest

/// Needs photo access granted to the app and sample photos; `scripts/test.sh` sets both up.
@MainActor
final class ReviewFlowUITests: XCTestCase {
    private let app = XCUIApplication()

    private func launch() {
        continueAfterFailure = false
        app.launchArguments = ["-ui-testing", "-seed-sample-library", "-empty-deletion-album"]
        app.launch()
        // First run: go through the real permission flow.
        let proceed = app.buttons["Continue"]
        if proceed.waitForExistence(timeout: 3) {
            proceed.tap()
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let allow = springboard.buttons["Allow Full Access"]
            XCTAssertTrue(allow.waitForExistence(timeout: 5), "Photo permission alert did not appear")
            allow.tap()
        }
    }

    private func openOctober() {
        launch()
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS 'October 2026'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15), "October 2026 row not found. Did scripts/test.sh seed the library?")
        row.tap()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5))
    }

    private var subtitle: String {
        let predicate = NSPredicate(format: "label MATCHES '^[0-9]+ of [0-9]+ · [0-9]+%$'")
        let element = app.staticTexts.matching(predicate).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 5))
        return element.label
    }

    private var card: XCUIElement {
        app.images.matching(NSPredicate(format: "label BEGINSWITH 'Photo' OR label BEGINSWITH 'Video'")).firstMatch
    }

    /// Same rounding as the app: to nearest, never 100% until everything is decided, nor 0% once one is.
    private func percent(_ decided: Int, of total: Int) -> Int {
        if decided >= total { return 100 }
        if decided == 0 { return 0 }
        return min(99, max(1, Int((Double(decided) * 100 / Double(total)).rounded())))
    }

    func testSwipeUndoAndFlip() {
        openOctober()
        // Read the month size from the screen; the simulator library may hold more than the samples.
        let first = subtitle
        let total = Int(first.split(separator: " ")[2])!
        XCTAssertEqual(first, "1 of \(total) · 0%")

        card.swipeLeft(velocity: .fast)
        XCTAssertEqual(subtitle, "2 of \(total) · \(percent(1, of: total))%")

        // Swipe again straight away, before the first card has finished flying off.
        card.swipeRight(velocity: .fast)
        XCTAssertEqual(subtitle, "3 of \(total) · \(percent(2, of: total))%")

        app.navigationBars.buttons["Undo"].tap()
        XCTAssertEqual(subtitle, "2 of \(total) · \(percent(1, of: total))%", "Undo should return to the photo it changed")

        // Go back to the first photo and flip it from delete to keep.
        app.buttons["Previous"].tap()
        XCTAssertEqual(subtitle, "1 of \(total) · \(percent(1, of: total))%")
        app.buttons["Keep"].tap()
        XCTAssertEqual(subtitle, "2 of \(total) · \(percent(1, of: total))%")

        app.navigationBars.buttons.element(boundBy: 0).tap()
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS 'October 2026'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertEqual(row.value as? String, "\(percent(1, of: total))% sorted, \(total) items")
    }

    func testFinishingAMonthShowsSummary() {
        launch()
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS 'December 2025'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        XCTAssertTrue(app.buttons["Keep"].waitForExistence(timeout: 5))
        app.buttons["Delete"].tap()
        var taps = 0
        while !app.staticTexts["December Is Sorted"].exists, app.buttons["Keep"].exists, taps < 100 {
            app.buttons["Keep"].tap()
            taps += 1
        }
        XCTAssertTrue(app.staticTexts["December Is Sorted"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Open Photos"].exists)
        let toFree = app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'To Free'")).firstMatch
        XCTAssertTrue(toFree.waitForExistence(timeout: 3))
        let sized = NSPredicate(format: "NOT (label CONTAINS '–')")
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectation(for: sized, evaluatedWith: toFree)], timeout: 5), .completed,
            "To Free stayed empty: \(toFree.label)")

        // Close the summary, go back and change a sorted photo: the summary must not come back.
        app.swipeDown(velocity: .fast)
        let again = app.buttons["Review Again from the Start"]
        XCTAssertTrue(again.waitForExistence(timeout: 5))
        again.tap()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5))
        app.buttons["Delete"].tap()
        app.buttons["Keep"].tap()
        sleep(1)
        XCTAssertFalse(app.buttons["Open Photos"].exists, "Summary sheet came back after changing a sorted photo")
        XCTAssertTrue(app.buttons["Keep"].exists, "Review should stay on the photos")
    }

    func testAccessibilityAudit() throws {
        openOctober()
        try app.performAccessibilityAudit(for: [.dynamicType, .sufficientElementDescription, .hitRegion, .contrast]) { issue in
            // Photo content is not UI; its colours are whatever the photo is.
            let ignored = issue.element?.label.hasPrefix("Photo") == true
            print(
                "AUDIT \(ignored ? "ignored" : "FAILED"): \(issue.compactDescription) — \(issue.element?.debugDescription ?? "no element")")
            return ignored
        }
    }

    /// Screens for design review. Export with `xcrun xcresulttool export attachments`.
    func testCaptureScreens() {
        launch()
        let row = app.buttons.matching(NSPredicate(format: "label CONTAINS 'September 2026'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        snap("1-months")
        row.tap()
        XCTAssertTrue(app.buttons["Delete"].waitForExistence(timeout: 5))
        sleep(1)
        snap("2-review")
        app.buttons["Delete"].tap()
        app.buttons["Keep"].tap()
        sleep(1)
        snap("3-review-after-decisions")
        // The toolbar hides under the done sheet, so stop when Keep is gone.
        while !app.staticTexts["September Is Sorted"].exists, app.buttons["Keep"].exists {
            app.buttons["Keep"].tap()
        }
        XCTAssertTrue(app.staticTexts["September Is Sorted"].waitForExistence(timeout: 5))
        sleep(1)
        snap("4-month-done")
    }

    private func snap(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

import Foundation
import Testing

@testable import Sift

struct MonthIndexTests {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Amsterdam")!
        return calendar
    }()

    private func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 12, _ min: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    @Test func groupsByMonthOldestFirst() {
        let index = MonthIndex.build(
            from: [
                LibraryItem(id: "b", date: date(2026, 3, 20)),
                LibraryItem(id: "a", date: date(2026, 3, 2)),
                LibraryItem(id: "c", date: date(2026, 4, 1)),
                LibraryItem(id: "d", date: date(2025, 12, 31)),
            ], calendar: calendar)

        #expect(index.ids(in: MonthKey(year: 2026, month: 3)) == ["a", "b"])
        #expect(index.months == [MonthKey(year: 2026, month: 4), MonthKey(year: 2026, month: 3), MonthKey(year: 2025, month: 12)])
        #expect(index.years == [2026, 2025])
        #expect(index.totalCount == 4)
    }

    @Test func monthBoundaryUsesLocalTime() {
        // 23:59 on 31 Jan local time is still January, even though it is later in UTC terms.
        let index = MonthIndex.build(
            from: [
                LibraryItem(id: "late", date: date(2026, 1, 31, 23, 59)),
                LibraryItem(id: "early", date: date(2026, 2, 1, 0, 0)),
            ], calendar: calendar)
        #expect(index.ids(in: MonthKey(year: 2026, month: 1)) == ["late"])
        #expect(index.ids(in: MonthKey(year: 2026, month: 2)) == ["early"])
    }

    @Test func nextMonthSkipsCompletedMonths() {
        let index = MonthIndex.build(
            from: [
                LibraryItem(id: "a", date: date(2026, 5, 1)),
                LibraryItem(id: "b", date: date(2026, 4, 1)),
                LibraryItem(id: "c", date: date(2026, 3, 1)),
            ], calendar: calendar)
        let done: Set<MonthKey> = [MonthKey(year: 2026, month: 4)]
        #expect(index.nextMonth(after: MonthKey(year: 2026, month: 5)) { done.contains($0) } == MonthKey(year: 2026, month: 3))
        #expect(index.nextMonth(after: MonthKey(year: 2026, month: 3)) { done.contains($0) } == nil)
    }

    @Test func emptyLibrary() {
        let index = MonthIndex.build(from: [], calendar: calendar)
        #expect(index.months.isEmpty)
        #expect(index.totalCount == 0)
    }
}

struct SwipePhysicsTests {
    @Test func shortFastFlickCommits() {
        // Released at 40 pt, but moving fast enough to project well past the threshold.
        #expect(SwipePhysics.verdict(translation: -40, predictedEnd: -260, width: 360) == .delete)
        #expect(SwipePhysics.verdict(translation: 40, predictedEnd: 260, width: 360) == .keep)
    }

    @Test func slowReleaseBelowThresholdSnapsBack() {
        #expect(SwipePhysics.verdict(translation: 80, predictedEnd: 90, width: 360) == nil)
    }

    @Test func flickBackTowardCentreCancels() {
        // Past the threshold but thrown back toward the centre.
        #expect(SwipePhysics.verdict(translation: 200, predictedEnd: 140, width: 360) == nil)
    }

    @Test func rubberBandResistsMoreTheFurtherYouPull() {
        let small = SwipePhysics.rubberBand(50, dimension: 600)
        let large = SwipePhysics.rubberBand(500, dimension: 600)
        #expect(small < 50 && small > 0)
        #expect(large / 500 < small / 50)
        #expect(SwipePhysics.rubberBand(-50, dimension: 600) == -small)
    }

    @Test func relativeVelocityIsScaledByDistanceLeft() {
        #expect(SwipePhysics.relativeVelocity(50, from: 50, to: 150) == 0.5)
        #expect(SwipePhysics.relativeVelocity(100, from: 0, to: 0) == 0)
    }
}

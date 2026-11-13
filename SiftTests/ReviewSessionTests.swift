import Testing

@testable import Sift

struct ReviewSessionTests {
    private let ids = ["a", "b", "c"]

    private func started(_ ids: [String], decided: Set<String> = []) -> ReviewSession {
        var session = ReviewSession()
        session.start(ids: ids, isDecided: decided.contains)
        return session
    }

    /// Finishes a two-photo month on its last photo, so the summary is up.
    private func summary() -> ReviewSession {
        var session = started(["a", "b"], decided: ["a"])
        session.decide(ids: ["a", "b"], wasComplete: false, isDecided: { _ in true })
        return session
    }

    // MARK: start

    @Test func startGoesToTheFirstUndecidedPhoto() {
        #expect(started(ids, decided: ["a"]).mode == .reviewing("b"))
    }

    @Test func startOnASortedMonthShowsTheFirstPhoto() {
        #expect(started(ids, decided: ["a", "b", "c"]).mode == .reviewing("a"))
    }

    @Test func startOnAnEmptyMonthIsSorted() {
        #expect(started([]).mode == .sorted)
    }

    @Test func startRunsOnce() {
        var session = started(ids)
        session.step(by: 1, ids: ids)
        session.start(ids: ids, isDecided: { _ in false })
        #expect(session.mode == .reviewing("b"))
    }

    // MARK: decide

    @Test func decideMovesToTheNextPhoto() {
        var session = started(ids)
        session.decide(ids: ids, wasComplete: false, isDecided: ["a"].contains)
        #expect(session.mode == .reviewing("b"))
    }

    @Test func decisionThatFinishesTheMonthShowsTheSummary() {
        #expect(summary().mode == .summary)
    }

    @Test func decisionInASortedMonthNeverShowsTheSummary() {
        var session = started(ids, decided: ["a", "b", "c"])
        session.decide(ids: ids, wasComplete: true, isDecided: { _ in true })
        #expect(session.mode == .reviewing("b"))
        session.jump(to: "c", ids: ids)
        session.decide(ids: ids, wasComplete: true, isDecided: { _ in true })
        #expect(session.mode == .sorted)
    }

    @Test func decisionOnTheLastPhotoWithGapsGoesToTheFirstGap() {
        var session = started(ids)
        session.jump(to: "c", ids: ids)
        session.decide(ids: ids, wasComplete: false, isDecided: ["c"].contains)
        #expect(session.mode == .reviewing("a"))
    }

    @Test func decideWithoutACurrentPhotoDoesNothing() {
        var session = started([])
        session.decide(ids: [], wasComplete: true, isDecided: { _ in true })
        #expect(session.mode == .sorted)
    }

    // MARK: step and jump

    @Test func stepMovesWithinTheMonth() {
        var session = started(ids)
        let movedBack = session.step(by: -1, ids: ids)
        #expect(!movedBack)
        #expect(session.mode == .reviewing("a"))
        let movedOn = session.step(by: 1, ids: ids)
        #expect(movedOn)
        #expect(session.mode == .reviewing("b"))
        #expect(session.index(in: ids) == 1)
    }

    @Test func jumpGoesToAnyPhotoInTheMonth() {
        var session = started(ids)
        let same = session.jump(to: "a", ids: ids)
        #expect(!same, "Already there")
        let outside = session.jump(to: "elsewhere", ids: ids)
        #expect(!outside)
        let jumped = session.jump(to: "c", ids: ids)
        #expect(jumped)
        #expect(session.mode == .reviewing("c"))
    }

    @Test func reviewAgainFromTheSortedScreen() {
        var session = started(ids, decided: ["a", "b", "c"])
        session.jump(to: "c", ids: ids)
        session.decide(ids: ids, wasComplete: true, isDecided: { _ in true })
        #expect(session.mode == .sorted)
        let jumped = session.jump(to: "a", ids: ids)
        #expect(jumped)
        #expect(session.mode == .reviewing("a"))
    }

    // MARK: summary

    @Test func closingTheSummaryShowsTheSortedScreen() {
        var session = summary()
        session.dismissSummary(ids: ["a", "b"], isDecided: { _ in true })
        #expect(session.mode == .sorted)
    }

    @Test func closingTheSummaryOfAMonthNoLongerSortedReviewsTheGap() {
        var session = summary()
        session.dismissSummary(ids: ["a", "b"], isDecided: ["b"].contains)
        #expect(session.mode == .reviewing("a"))
    }

    // MARK: undo and redo

    @Test func undoBringsTheCardBackOverTheSummary() {
        var session = summary()
        let returned = session.returnFromUndo("b", undone: .keep, ids: ["a", "b"], isDecided: ["a"].contains)
        #expect(returned)
        #expect(session.mode == .reviewing("b"))
    }

    @Test func undoInAnotherMonthIsIgnored() {
        var session = started(ids)
        let returned = session.returnFromUndo("elsewhere", undone: .keep, ids: ids, isDecided: { _ in false })
        #expect(!returned)
        #expect(session.mode == .reviewing("a"))
    }

    @Test func redoOfTheFinishingDecisionShowsTheSummary() {
        var session = summary()
        session.returnFromUndo("b", undone: .keep, ids: ["a", "b"], isDecided: ["a"].contains)
        // A redo takes back "undecided" (nil) and finishes the month again.
        session.returnFromUndo("b", undone: nil, ids: ["a", "b"], isDecided: { _ in true })
        #expect(session.mode == .summary)
    }

    @Test func undoOfAFlipInASortedMonthKeepsReviewing() {
        var session = started(ids, decided: ["a", "b", "c"])
        session.returnFromUndo("b", undone: .delete, ids: ids, isDecided: { _ in true })
        #expect(session.mode == .reviewing("b"))
    }

    // MARK: library changes

    @Test func vanishedPhotoIsReplacedByThePhotoNowInItsPlace() {
        var session = started(ids)
        session.step(by: 1, ids: ids)
        session.libraryChanged(ids: ["a", "c"], isDecided: { _ in false })
        #expect(session.mode == .reviewing("c"))
        #expect(session.index(in: ["a", "c"]) == 1)
    }

    @Test func vanishedLastPhotoFallsBackToTheNewLastPhoto() {
        var session = started(ids)
        session.jump(to: "c", ids: ids)
        session.libraryChanged(ids: ["a", "b"], isDecided: { _ in false })
        #expect(session.mode == .reviewing("b"))
    }

    @Test func positionFollowsThePhotoWhenOthersVanish() {
        var session = started(ids)
        session.step(by: 1, ids: ids)
        session.libraryChanged(ids: ["b", "c"], isDecided: { _ in false })
        #expect(session.mode == .reviewing("b"))
        session.libraryChanged(ids: ["c"], isDecided: { _ in false })
        #expect(session.mode == .reviewing("c"))
    }

    @Test func emptiedMonthIsSorted() {
        var session = started(ids)
        session.libraryChanged(ids: [], isDecided: { _ in false })
        #expect(session.mode == .sorted)
    }

    @Test func sortedScreenGivesWayWhenAVerdictIsCleared() {
        var session = started(ids, decided: ["a", "b", "c"])
        session.jump(to: "c", ids: ids)
        session.decide(ids: ids, wasComplete: true, isDecided: { _ in true })
        session.libraryChanged(ids: ids, isDecided: ["a", "c"].contains)
        #expect(session.mode == .reviewing("b"))
    }

    @Test func sortedScreenStaysWhileTheMonthIsSorted() {
        var session = started([])
        session.libraryChanged(ids: ids, isDecided: { _ in true })
        #expect(session.mode == .sorted)
    }

    @Test func libraryChangeLeavesTheSummaryUp() {
        var session = summary()
        session.libraryChanged(ids: ["a", "b"], isDecided: ["a"].contains)
        #expect(session.mode == .summary)
    }
}

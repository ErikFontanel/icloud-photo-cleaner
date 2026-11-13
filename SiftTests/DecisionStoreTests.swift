import Foundation
import SwiftData
import Testing

@testable import Sift

final class FakeAlbum: DeletionAlbumSyncing {
    private(set) var members: Set<String> = []
    private(set) var log: [String] = []

    func add(_ ids: [String]) async throws {
        members.formUnion(ids)
        log.append("add \(ids.sorted().joined(separator: ","))")
    }

    func remove(_ ids: [String]) async throws {
        members.subtract(ids)
        log.append("remove \(ids.sorted().joined(separator: ","))")
    }
}

@MainActor
struct DecisionStoreTests {
    let container: ModelContainer
    let album = FakeAlbum()
    let undo: UndoManager

    init() throws {
        container = try ModelContainer(for: Decision.self, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
        undo = UndoManager()
        undo.groupsByEvent = false
    }

    private func makeStore() -> DecisionStore {
        DecisionStore(context: container.mainContext, album: album)
    }

    /// One user action, as the run loop would group it.
    private func action(_ body: () -> Void) {
        undo.beginUndoGrouping()
        body()
        undo.endUndoGrouping()
    }

    @Test func deleteAddsToAlbumAndKeepDoesNot() async {
        let store = makeStore()
        action { store.set(.delete, for: "a", undoManager: undo) }
        action { store.set(.keep, for: "b", undoManager: undo) }
        await store.flushAlbum()
        #expect(album.members == ["a"])
        #expect(store.progress(for: ["a", "b", "c"]) == MonthProgress(total: 3, decided: 2, toDelete: 1))
    }

    @Test func flippingDeleteToKeepRemovesFromAlbum() async {
        let store = makeStore()
        action { store.set(.delete, for: "a", undoManager: undo) }
        action { store.set(.keep, for: "a", undoManager: undo) }
        await store.flushAlbum()
        #expect(album.members.isEmpty)
        #expect(album.log == ["add a", "remove a"])
        #expect(store.verdict(for: "a") == .keep)
    }

    @Test func undoRestoresPreviousVerdictAndReportsIt() async {
        let store = makeStore()
        action { store.set(.keep, for: "a", undoManager: undo) }
        action { store.set(.delete, for: "a", undoManager: undo) }

        undo.undo()
        await store.flushAlbum()
        #expect(store.verdict(for: "a") == .keep)
        #expect(album.members.isEmpty)
        #expect(store.lastUndo?.assetID == "a")
        #expect(store.lastUndo?.undone == .delete)

        undo.undo()
        #expect(store.verdict(for: "a") == nil)
        #expect(store.lastUndo?.undone == .keep)
        #expect(!undo.canUndo)
    }

    @Test func redoReappliesTheDecision() async {
        let store = makeStore()
        action { store.set(.delete, for: "a", undoManager: undo) }
        undo.undo()
        undo.redo()
        await store.flushAlbum()
        #expect(store.verdict(for: "a") == .delete)
        #expect(album.members == ["a"])
    }

    @Test func decisionsSurviveRelaunch() {
        let first = makeStore()
        action { first.set(.delete, for: "a", undoManager: undo) }
        action { first.set(.keep, for: "b", undoManager: undo) }
        let second = makeStore()
        #expect(second.verdict(for: "a") == .delete)
        #expect(second.verdict(for: "b") == .keep)
    }

    @Test func reconcileForgetsPhotosRemovedFromLibrary() {
        let store = makeStore()
        action { store.set(.keep, for: "gone", undoManager: undo) }
        action { store.set(.keep, for: "here", undoManager: undo) }
        store.reconcile(libraryIDs: ["here"], albumMembers: [])
        #expect(store.verdict(for: "gone") == nil)
        #expect(store.verdict(for: "here") == .keep)
    }

    @Test func reconcileTreatsManualAlbumRemovalAsUndecided() {
        let store = makeStore()
        action { store.set(.delete, for: "a", undoManager: undo) }
        action { store.set(.delete, for: "b", undoManager: undo) }
        store.reconcile(libraryIDs: ["a", "b"], albumMembers: ["b"])
        #expect(store.verdict(for: "a") == nil)
        #expect(store.verdict(for: "b") == .delete)
    }

    @Test func reconcileRecreatesDeletedAlbum() async {
        let store = makeStore()
        action { store.set(.delete, for: "a", undoManager: undo) }
        await store.flushAlbum()
        store.reconcile(libraryIDs: ["a"], albumMembers: nil)
        await store.flushAlbum()
        #expect(album.log.last == "add a")
        #expect(store.verdict(for: "a") == .delete)
    }

    @Test func percentNeverRoundsUpTo100() {
        #expect(MonthProgress(total: 1000, decided: 999, toDelete: 0).percent == 99)
        #expect(MonthProgress(total: 3, decided: 3, toDelete: 1).percent == 100)
        #expect(MonthProgress(total: 0, decided: 0, toDelete: 0).isComplete)
    }

    @Test func percentRoundsToNearest() {
        #expect(MonthProgress(total: 12, decided: 2, toDelete: 0).percent == 17)
        #expect(MonthProgress(total: 12, decided: 1, toDelete: 0).percent == 8)
        #expect(MonthProgress(total: 1000, decided: 1, toDelete: 0).percent == 1)
        #expect(MonthProgress(total: 12, decided: 0, toDelete: 0).percent == 0)
    }
}

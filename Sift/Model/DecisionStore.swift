import Foundation
import Observation
import SwiftData

nonisolated enum Verdict: String, Codable, Sendable {
    case keep, delete
}

@Model
final class Decision {
    #Unique<Decision>([\.assetID])
    var assetID: String
    var verdictRaw: String
    var decidedAt: Date

    init(assetID: String, verdict: Verdict, decidedAt: Date = .now) {
        self.assetID = assetID
        self.verdictRaw = verdict.rawValue
        self.decidedAt = decidedAt
    }

    var verdict: Verdict? { Verdict(rawValue: verdictRaw) }
}

/// Mirror of "delete" verdicts in Photos. Implemented by `DeletionAlbum`; faked in tests.
protocol DeletionAlbumSyncing: AnyObject {
    func add(_ ids: [String]) async throws
    func remove(_ ids: [String]) async throws
}

nonisolated struct MonthProgress: Equatable, Sendable {
    var total: Int
    var decided: Int
    var toDelete: Int

    var fraction: Double { total == 0 ? 1 : Double(decided) / Double(total) }
    var isComplete: Bool { decided >= total }
    var percent: Int {
        // Round to nearest, but never 100% until every item is decided, nor 0% once one is.
        if isComplete { return 100 }
        let value = Int((fraction * 100).rounded())
        return decided > 0 ? min(max(value, 1), 99) : 0
    }
}

@Observable
final class DecisionStore {
    struct UndoEvent: Equatable {
        let assetID: String
        /// The verdict that was taken back, so the card can return from the side it left.
        let undone: Verdict?
        let serial: Int
    }

    private(set) var verdicts: [String: Verdict] = [:]
    /// Changes on every undo or redo, so the review screen can jump to that photo.
    private(set) var lastUndo: UndoEvent?
    private(set) var albumError: String?

    private let context: ModelContext
    private let album: DeletionAlbumSyncing
    private var albumQueue: Task<Void, Never>?
    private var undoSerial = 0

    init(context: ModelContext, album: DeletionAlbumSyncing) {
        self.context = context
        self.album = album
        let stored = (try? context.fetch(FetchDescriptor<Decision>())) ?? []
        for decision in stored {
            if let verdict = decision.verdict { verdicts[decision.assetID] = verdict }
        }
    }

    func verdict(for id: String) -> Verdict? { verdicts[id] }

    func progress(for ids: [String]) -> MonthProgress {
        var decided = 0
        var toDelete = 0
        for id in ids {
            guard let verdict = verdicts[id] else { continue }
            decided += 1
            if verdict == .delete { toDelete += 1 }
        }
        return MonthProgress(total: ids.count, decided: decided, toDelete: toDelete)
    }

    /// Sets or clears a verdict and registers the reverse with `undoManager`.
    func set(_ verdict: Verdict?, for id: String, undoManager: UndoManager?) {
        let old = verdicts[id]
        guard old != verdict else { return }
        apply(verdict, for: id, previous: old)

        guard let undoManager else { return }
        undoManager.registerUndo(withTarget: self) { store in
            MainActor.assumeIsolated {
                store.set(old, for: id, undoManager: undoManager)
                store.undoSerial += 1
                store.lastUndo = UndoEvent(assetID: id, undone: verdict, serial: store.undoSerial)
            }
        }
        undoManager.setActionName(verdict == .delete ? "Mark for Deletion" : verdict == .keep ? "Keep" : "Clear")
    }

    /// Brings stored decisions in line with the library and the album.
    /// - Parameters:
    ///   - libraryIDs: every asset currently in the library.
    ///   - albumMembers: assets in the deletion album, or `nil` when the album no longer exists.
    func reconcile(libraryIDs: Set<String>, albumMembers: Set<String>?) {
        for id in verdicts.keys where !libraryIDs.contains(id) {
            apply(nil, for: id, previous: verdicts[id], syncAlbum: false)
        }
        let marked = verdicts.filter { $0.value == .delete }.map(\.key)
        if let albumMembers {
            // Removed from the album by hand in Photos: treat as undecided again.
            for id in marked where !albumMembers.contains(id) {
                apply(nil, for: id, previous: .delete, syncAlbum: false)
            }
        } else if !marked.isEmpty {
            // Album was deleted in Photos: recreate it with everything still marked.
            enqueue { try await self.album.add(marked) }
        }
    }

    func clearAlbumError() { albumError = nil }

    /// Waits until queued album changes have finished. Used by tests.
    func flushAlbum() async { await albumQueue?.value }

    private func apply(_ verdict: Verdict?, for id: String, previous: Verdict?, syncAlbum: Bool = true) {
        verdicts[id] = verdict
        persist(verdict, for: id)
        guard syncAlbum else { return }
        if verdict == .delete, previous != .delete {
            enqueue { try await self.album.add([id]) }
        } else if previous == .delete, verdict != .delete {
            enqueue { try await self.album.remove([id]) }
        }
    }

    private func persist(_ verdict: Verdict?, for id: String) {
        let descriptor = FetchDescriptor<Decision>(predicate: #Predicate { $0.assetID == id })
        let existing = try? context.fetch(descriptor).first
        switch (existing, verdict) {
        case (nil, nil): return
        case (let row?, nil): context.delete(row)
        case (let row?, let verdict?):
            row.verdictRaw = verdict.rawValue
            row.decidedAt = .now
        case (nil, let verdict?): context.insert(Decision(assetID: id, verdict: verdict))
        }
        try? context.save()
    }

    /// Album changes run one at a time, in order, so a quick undo never races its own swipe.
    private func enqueue(_ operation: @escaping () async throws -> Void) {
        let previous = albumQueue
        albumQueue = Task {
            await previous?.value
            do {
                try await operation()
                albumError = nil
            } catch {
                albumError = "Couldn't update the \(DeletionAlbumTitle.value) album. \(error.localizedDescription)"
            }
        }
    }
}

nonisolated enum DeletionAlbumTitle {
    static let value = "Sift – To Delete"
}

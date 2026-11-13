/// Where the review screen is in a month, and how it moves. The view owns animation; this owns which photo is up.
nonisolated struct ReviewSession: Equatable {
    enum Mode: Equatable {
        case reviewing(String)
        /// The month was just finished; its summary sheet is up.
        case summary
        /// Nothing is current and the month is sorted.
        case sorted
    }

    private(set) var mode: Mode = .sorted
    private var didStart = false
    /// Index of the current photo, so a photo that vanishes is replaced by the one now in its place.
    private var position = 0

    var currentID: String? {
        if case .reviewing(let id) = mode { id } else { nil }
    }

    func index(in ids: [String]) -> Int? { currentID.flatMap { ids.firstIndex(of: $0) } }

    mutating func start(ids: [String], isDecided: (String) -> Bool) {
        guard !didStart else { return }
        didStart = true
        if let id = ids.first(where: { !isDecided($0) }) ?? ids.first {
            review(id, in: ids)
        } else {
            mode = .sorted
        }
    }

    /// Call after the verdict for the current photo is stored.
    mutating func decide(ids: [String], wasComplete: Bool, isDecided: (String) -> Bool) {
        guard let index = index(in: ids) else { return }
        if !wasComplete, ids.allSatisfy(isDecided) {
            // Only the decision that finishes the month shows the summary; changing sorted photos later does not.
            mode = .summary
        } else if index + 1 < ids.count {
            review(ids[index + 1], in: ids)
        } else if let gap = ids.first(where: { !isDecided($0) }) {
            // End of the month with gaps left: go to the first undecided photo.
            review(gap, in: ids)
        } else {
            mode = .sorted
        }
    }

    /// Previous and next move through photos without deciding.
    @discardableResult
    mutating func step(by delta: Int, ids: [String]) -> Bool {
        guard let index = index(in: ids), ids.indices.contains(index + delta) else { return false }
        review(ids[index + delta], in: ids)
        return true
    }

    @discardableResult
    mutating func jump(to id: String, ids: [String]) -> Bool {
        guard id != currentID, ids.contains(id) else { return false }
        review(id, in: ids)
        return true
    }

    /// An undo or redo changed `id`; `undone` is the verdict it took back (`nil` for a redo of a first decision).
    @discardableResult
    mutating func returnFromUndo(_ id: String, undone: Verdict?, ids: [String], isDecided: (String) -> Bool) -> Bool {
        guard ids.contains(id) else { return false }
        if undone == nil, ids.allSatisfy(isDecided) {
            // Redo of the decision that finished the month.
            mode = .summary
        } else {
            review(id, in: ids)
        }
        return true
    }

    mutating func dismissSummary(ids: [String], isDecided: (String) -> Bool) {
        guard mode == .summary else { return }
        mode = .sorted
        libraryChanged(ids: ids, isDecided: isDecided)
    }

    /// The month's photos or verdicts changed underneath the screen.
    mutating func libraryChanged(ids: [String], isDecided: (String) -> Bool) {
        switch mode {
        case .reviewing(let id):
            if let index = ids.firstIndex(of: id) {
                position = index
            } else if ids.isEmpty {
                mode = .sorted
            } else {
                review(ids[min(position, ids.count - 1)], in: ids)
            }
        case .sorted:
            if let gap = ids.first(where: { !isDecided($0) }) { review(gap, in: ids) }
        case .summary:
            break
        }
    }

    private mutating func review(_ id: String, in ids: [String]) {
        mode = .reviewing(id)
        position = ids.firstIndex(of: id) ?? 0
    }
}

import Combine
import SwiftUI

struct ReviewView: View {
    let month: MonthKey
    let onNextMonth: (MonthKey) -> Void

    @Environment(PhotoLibrary.self) private var library
    @Environment(DecisionStore.self) private var store
    @Environment(\.undoManager) private var undoManager
    @Environment(\.displayScale) private var scale

    @State private var currentID: String?
    @State private var didStart = false
    @State private var entryOffset: CGFloat = 0
    @State private var departures: [Departure] = []
    @State private var dragProgress: CGFloat = 0
    @State private var showDone = false
    @State private var commitCount = 0
    @State private var undoCount = 0
    @State private var canUndo = false
    @State private var cardSize: CGSize = .zero

    private var ids: [String] { library.index.ids(in: month) }
    private var currentIndex: Int? { currentID.flatMap { ids.firstIndex(of: $0) } }
    private var progress: MonthProgress { store.progress(for: ids) }

    var body: some View {
        VStack(spacing: 12) {
            GeometryReader { proxy in
                let size = CGSize(width: proxy.size.width - 32, height: proxy.size.height)
                ZStack {
                    if let currentID {
                        cardStack(currentID: currentID, size: size)
                    } else if !showDone {
                        sortedState
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .onAppear { cardSize = size }
                .onChange(of: size) { _, new in cardSize = new }
            }
            Filmstrip(ids: ids, currentID: currentID) { id in jump(to: id) }
                .frame(height: 52)
                // Nothing of the review screen may show around or through the summary sheet.
                .opacity(showDone ? 0 : 1)
                .accessibilityHidden(showDone)
        }
        .padding(.top, 8)
        .padding(.bottom, 4)
        .navigationTitle(month.titleWithYear)
        .navigationSubtitle(subtitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        // The sheet is glass too; hide the glass toolbar under it.
        .toolbar(showDone ? .hidden : .visible, for: .bottomBar)
        .alert("Album Not Updated", isPresented: albumErrorShown) {
            Button("OK") { store.clearAlbumError() }
        } message: {
            Text(store.albumError ?? "")
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: commitCount)
        .sensoryFeedback(.impact(flexibility: .soft), trigger: undoCount)
        .sheet(isPresented: $showDone) {
            MonthDoneSheet(month: month, progress: progress, ids: ids, nextMonth: nextMonth) { next in
                showDone = false
                onNextMonth(next)
            }
        }
        .onAppear(perform: start)
        .onChange(of: store.lastUndo) { _, event in
            guard let event else { return }
            returnFromUndo(event)
        }
        .onChange(of: currentID) { prefetch() }
        .onReceive(undoChanges) { _ in
            canUndo = undoManager?.canUndo ?? false
        }
        .onDisappear {
            // Shake to undo should only change photos you can see.
            undoManager?.removeAllActions(withTarget: store)
        }
    }

    private var undoChanges: AnyPublisher<Notification, Never> {
        let center = NotificationCenter.default
        return Publishers.MergeMany(
            [
                Notification.Name.NSUndoManagerCheckpoint, .NSUndoManagerDidUndoChange, .NSUndoManagerDidRedoChange,
                .NSUndoManagerDidCloseUndoGroup,
            ]
            .map { center.publisher(for: $0) }
        )
        .receive(on: RunLoop.main)
        .eraseToAnyPublisher()
    }

    private var albumErrorShown: Binding<Bool> {
        Binding(get: { store.albumError != nil }, set: { if !$0 { store.clearAlbumError() } })
    }

    // MARK: Cards

    @ViewBuilder
    private func cardStack(currentID: String, size: CGSize) -> some View {
        if let index = currentIndex, index + 1 < ids.count {
            // The next card waits underneath and rises as you drag, hinting at what comes next.
            CardContent(assetID: ids[index + 1], size: size, isTop: false, progress: 0)
                .scaleEffect(0.94 + 0.06 * min(abs(dragProgress), 1))
                .accessibilityHidden(true)
                .allowsHitTesting(false)
                .id("under-\(ids[index + 1])")
        }
        SwipeCard(assetID: currentID, size: size, entryOffset: entryOffset, dragProgress: $dragProgress) { verdict, pose in
            decide(verdict, pose: pose)
        }
        .id(currentID)
        ForEach(departures) { departure in
            DepartingCard(departure: departure, size: size) {
                departures.removeAll { $0.id == departure.id }
            }
        }
    }

    private var sortedState: some View {
        ContentUnavailableView {
            Label("\(month.title) Is Sorted", systemImage: "checkmark.circle.fill")
                .symbolRenderingMode(.multicolor)
        } description: {
            Text(
                progress.toDelete == 0
                    ? "You kept everything this month."
                    : progress.toDelete == 1
                        ? "1 item marked for deletion is in the “\(DeletionAlbumTitle.value)” album."
                        : "\(progress.toDelete.formatted()) items marked for deletion are in the “\(DeletionAlbumTitle.value)” album.")
        } actions: {
            if let nextMonth {
                Button("Next Month: \(nextMonth.title)") { onNextMonth(nextMonth) }
                    .buttonStyle(.glassProminent)
            }
            Button("Review Again from the Start") { jump(to: ids.first) }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button("Undo", systemImage: "arrow.uturn.backward") { undoManager?.undo() }
                .disabled(!canUndo)
        }
        ToolbarItem(placement: .bottomBar) {
            Button("Previous", systemImage: "chevron.backward") { step(by: -1) }
                .disabled((currentIndex ?? ids.count) == 0)
        }
        ToolbarSpacer(.flexible, placement: .bottomBar)
        ToolbarItemGroup(placement: .bottomBar) {
            Button("Delete", systemImage: "trash") { decideFromButton(.delete) }
                .tint(.red)
                .scaleEffect(1 + 0.15 * max(0, -dragProgress))
                .disabled(currentID == nil)
            Button("Keep", systemImage: "checkmark") { decideFromButton(.keep) }
                .tint(.green)
                .scaleEffect(1 + 0.15 * max(0, dragProgress))
                .disabled(currentID == nil)
        }
        ToolbarSpacer(.flexible, placement: .bottomBar)
        ToolbarItem(placement: .bottomBar) {
            Button("Next", systemImage: "chevron.forward") { step(by: 1) }
                .disabled(currentIndex.map { $0 + 1 >= ids.count } ?? true)
        }
    }

    private var subtitle: String {
        guard let index = currentIndex else { return "\(progress.percent)% sorted" }
        return "\((index + 1).formatted()) of \(ids.count.formatted()) · \(progress.percent)%"
    }

    private var nextMonth: MonthKey? {
        library.index.nextMonth(after: month) { store.progress(for: library.index.ids(in: $0)).isComplete }
    }

    // MARK: Actions

    private func start() {
        guard !didStart else { return }
        didStart = true
        currentID = ids.first { store.verdict(for: $0) == nil } ?? ids.first
        canUndo = undoManager?.canUndo ?? false
    }

    private func decideFromButton(_ verdict: Verdict) {
        decide(verdict, pose: CardPose(velocity: CGSize(width: verdict == .delete ? -1600 : 1600, height: 0)))
    }

    private func decide(_ verdict: Verdict, pose: CardPose) {
        guard let id = currentID, let index = currentIndex else { return }
        let wasComplete = progress.isComplete
        store.set(verdict, for: id, undoManager: undoManager)
        departures.append(Departure(assetID: id, verdict: verdict, pose: pose, direction: verdict == .delete ? -1 : 1))
        commitCount += 1
        dragProgress = 0
        entryOffset = 0

        if !wasComplete, progress.isComplete {
            // Only the decision that finishes the month shows the summary; changing sorted photos later does not.
            currentID = nil
            showDone = true
        } else if index + 1 < ids.count {
            currentID = ids[index + 1]
        } else if wasComplete {
            currentID = nil
        } else {
            // End of the month with gaps left: go to the first undecided photo.
            currentID = ids.first { store.verdict(for: $0) == nil }
        }
    }

    /// Previous and next move through photos without deciding.
    private func step(by delta: Int) {
        guard let index = currentIndex, let id = currentID else { return }
        let target = index + delta
        guard ids.indices.contains(target) else { return }
        departures.append(Departure(assetID: id, verdict: nil, pose: CardPose(), direction: delta > 0 ? -1 : 1))
        entryOffset = delta > 0 ? cardSize.width * SwipePhysics.flyOffFraction : -cardSize.width * SwipePhysics.flyOffFraction
        dragProgress = 0
        currentID = ids[target]
    }

    private func jump(to id: String?) {
        guard let id, id != currentID else { return }
        let from = currentIndex ?? 0
        let to = ids.firstIndex(of: id) ?? 0
        if let current = currentID {
            departures.append(Departure(assetID: current, verdict: nil, pose: CardPose(), direction: to >= from ? -1 : 1))
        }
        entryOffset = (to >= from ? 1 : -1) * cardSize.width * SwipePhysics.flyOffFraction
        dragProgress = 0
        currentID = id
    }

    /// The undone card comes back from the side it left.
    private func returnFromUndo(_ event: DecisionStore.UndoEvent) {
        guard ids.contains(event.assetID) else { return }
        undoCount += 1
        departures.removeAll { $0.assetID == event.assetID }
        let side: CGFloat = event.undone == .delete ? -1 : 1
        // The card that was on top makes way, leaving on the other side.
        if let current = currentID, current != event.assetID {
            departures.append(Departure(assetID: current, verdict: nil, pose: CardPose(), direction: -side))
        }
        entryOffset = side * cardSize.width * SwipePhysics.flyOffFraction
        dragProgress = 0
        showDone = false
        currentID = event.assetID
    }

    private func prefetch() {
        guard let index = currentIndex, cardSize != .zero else { return }
        let upcoming = Array(ids[(index + 1)..<min(index + 4, ids.count)])
        ImageLoader.shared.prefetch(upcoming, size: CGSize(width: cardSize.width * scale, height: cardSize.height * scale))
    }
}

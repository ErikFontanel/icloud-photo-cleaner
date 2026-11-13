import Combine
import SwiftUI

struct ReviewView: View {
    let month: MonthKey
    let onNextMonth: (MonthKey) -> Void

    @Environment(PhotoLibrary.self) private var library
    @Environment(DecisionStore.self) private var store
    @Environment(\.undoManager) private var undoManager
    @Environment(\.displayScale) private var scale

    @State private var session = ReviewSession()
    @State private var entryOffset: CGFloat = 0
    @State private var departures: [Departure] = []
    @State private var dragProgress: CGFloat = 0
    @State private var commitCount = 0
    @State private var undoCount = 0
    @State private var canUndo = false
    @State private var cardSize: CGSize = .zero

    private var ids: [String] { library.index.ids(in: month) }
    private var currentIndex: Int? { session.index(in: ids) }
    private var progress: MonthProgress { store.progress(for: ids) }
    private var showDone: Bool { session.mode == .summary }

    var body: some View {
        VStack(spacing: 12) {
            GeometryReader { proxy in
                let size = CGSize(width: proxy.size.width - 32, height: proxy.size.height)
                ZStack {
                    switch session.mode {
                    case .reviewing(let id): cardStack(currentID: id, size: size)
                    case .sorted: sortedState
                    case .summary: EmptyView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .onAppear { cardSize = size }
                .onChange(of: size) { _, new in cardSize = new }
            }
            Filmstrip(ids: ids, currentID: session.currentID) { id in jump(to: id) }
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
        .sheet(isPresented: summaryShown) {
            MonthDoneSheet(month: month, progress: progress, ids: ids, nextMonth: nextMonth) { next in
                session.dismissSummary(ids: ids, isDecided: isDecided)
                onNextMonth(next)
            }
        }
        .onAppear(perform: start)
        .onChange(of: store.lastUndo) { _, event in
            guard let event else { return }
            returnFromUndo(event)
        }
        .onChange(of: session.currentID) { prefetch() }
        // Photos added or removed, or verdicts cleared by a reconcile or a failed album change.
        .onChange(of: ids) { session.libraryChanged(ids: ids, isDecided: isDecided) }
        .onChange(of: progress) { session.libraryChanged(ids: ids, isDecided: isDecided) }
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

    private var summaryShown: Binding<Bool> {
        Binding(get: { showDone }, set: { if !$0 { session.dismissSummary(ids: ids, isDecided: isDecided) } })
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
            Button("Review Again from the Start") { if let first = ids.first { jump(to: first) } }
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
                .disabled((currentIndex ?? 0) == 0)
        }
        ToolbarSpacer(.flexible, placement: .bottomBar)
        ToolbarItemGroup(placement: .bottomBar) {
            Button("Delete", systemImage: "trash") { decideFromButton(.delete) }
                .tint(.red)
                .scaleEffect(1 + 0.15 * max(0, -dragProgress))
                .disabled(currentIndex == nil)
            Button("Keep", systemImage: "checkmark") { decideFromButton(.keep) }
                .tint(.green)
                .scaleEffect(1 + 0.15 * max(0, dragProgress))
                .disabled(currentIndex == nil)
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

    private func isDecided(_ id: String) -> Bool { store.verdict(for: id) != nil }

    private func start() {
        session.start(ids: ids, isDecided: isDecided)
        canUndo = undoManager?.canUndo ?? false
    }

    private func decideFromButton(_ verdict: Verdict) {
        decide(verdict, pose: CardPose(velocity: CGSize(width: verdict == .delete ? -1600 : 1600, height: 0)))
    }

    private func decide(_ verdict: Verdict, pose: CardPose) {
        guard let id = session.currentID, currentIndex != nil else { return }
        let wasComplete = progress.isComplete
        store.set(verdict, for: id, undoManager: undoManager)
        departures.append(Departure(assetID: id, verdict: verdict, pose: pose, direction: verdict == .delete ? -1 : 1))
        commitCount += 1
        dragProgress = 0
        entryOffset = 0
        session.decide(ids: ids, wasComplete: wasComplete, isDecided: isDecided)
    }

    /// Previous and next move through photos without deciding.
    private func step(by delta: Int) {
        guard let id = session.currentID, session.step(by: delta, ids: ids) else { return }
        departures.append(Departure(assetID: id, verdict: nil, pose: CardPose(), direction: delta > 0 ? -1 : 1))
        entryOffset = delta > 0 ? cardSize.width * SwipePhysics.flyOffFraction : -cardSize.width * SwipePhysics.flyOffFraction
        dragProgress = 0
    }

    private func jump(to id: String) {
        let from = currentIndex ?? 0
        let current = session.currentID
        guard session.jump(to: id, ids: ids) else { return }
        let to = currentIndex ?? 0
        if let current {
            departures.append(Departure(assetID: current, verdict: nil, pose: CardPose(), direction: to >= from ? -1 : 1))
        }
        entryOffset = (to >= from ? 1 : -1) * cardSize.width * SwipePhysics.flyOffFraction
        dragProgress = 0
    }

    /// The undone card comes back from the side it left.
    private func returnFromUndo(_ event: DecisionStore.UndoEvent) {
        let current = session.currentID
        guard session.returnFromUndo(event.assetID, undone: event.undone, ids: ids, isDecided: isDecided) else { return }
        undoCount += 1
        departures.removeAll { $0.assetID == event.assetID }
        let side: CGFloat = event.undone == .delete ? -1 : 1
        // The card that was on top makes way, leaving on the other side.
        if let current, current != event.assetID {
            departures.append(Departure(assetID: current, verdict: nil, pose: CardPose(), direction: -side))
        }
        entryOffset = side * cardSize.width * SwipePhysics.flyOffFraction
        dragProgress = 0
    }

    private func prefetch() {
        guard let index = currentIndex, cardSize != .zero else { return }
        let upcoming = Array(ids[(index + 1)..<min(index + 4, ids.count)])
        ImageLoader.shared.prefetch(upcoming, size: CGSize(width: cardSize.width * scale, height: cardSize.height * scale))
    }
}

import SwiftData
import SwiftUI

@main
struct SiftApp: App {
    @State private var library = PhotoLibrary()
    @State private var store: DecisionStore
    private let album = DeletionAlbum()
    private let container: ModelContainer

    init() {
        let inMemory = ProcessInfo.processInfo.arguments.contains("-ui-testing")
        container = try! ModelContainer(
            for: Decision.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: inMemory)
        )
        _store = State(initialValue: DecisionStore(context: container.mainContext, album: album))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(library)
                .environment(store)
                .task { await start() }
        }
        .modelContainer(container)
    }

    private func start() async {
        library.onReload = { [store, album] ids in
            store.reconcile(libraryIDs: ids, albumMembers: album.memberIDs())
        }
        #if DEBUG
            await SampleLibrary.prepareIfRequested(library: library)
        #endif
        await library.reload()
    }
}

struct RootView: View {
    @Environment(PhotoLibrary.self) private var library
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if library.hasFullAccess {
                MonthsView()
            } else {
                AccessView()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Back from Settings: pick up a changed permission.
            guard phase == .active else { return }
            let hadAccess = library.hasFullAccess
            library.refreshStatus()
            if library.hasFullAccess, !hadAccess { Task { await library.reload() } }
        }
    }
}

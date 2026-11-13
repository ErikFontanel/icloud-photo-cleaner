import SwiftUI

struct MonthsView: View {
    @Environment(PhotoLibrary.self) private var library
    @Environment(DecisionStore.self) private var store
    @Environment(\.openURL) private var openURL
    @State private var path: [MonthKey] = []
    @Namespace private var zoom

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if !library.hasLoaded {
                    ProgressView()
                } else if library.index.months.isEmpty {
                    ContentUnavailableView(
                        "No Photos", systemImage: "photo.on.rectangle",
                        description: Text("Photos and videos you take will appear here, grouped by month."))
                } else {
                    list
                }
            }
            .navigationTitle("Sift")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Open Photos", systemImage: "photo.on.rectangle") {
                        openURL(URL(string: "photos-redirect://")!)
                    }
                }
            }
            .navigationDestination(for: MonthKey.self) { month in
                ReviewView(month: month) { next in
                    path = [next]
                }
                .navigationTransition(.zoom(sourceID: month, in: zoom))
            }
        }
    }

    private var list: some View {
        List {
            Section {
                LibrarySummary(progress: store.progress(for: library.index.months.flatMap(library.index.ids(in:))))
            }
            ForEach(library.index.years, id: \.self) { year in
                Section {
                    ForEach(library.index.months(in: year)) { month in
                        let ids = library.index.ids(in: month)
                        NavigationLink(value: month) {
                            MonthRow(month: month, coverID: ids.first, progress: store.progress(for: ids))
                        }
                        .matchedTransitionSource(id: month, in: zoom)
                    }
                } header: {
                    Text(String(year))
                        .font(.title3.bold())
                        .foregroundStyle(.primary)
                        .textCase(nil)
                }
            }
        }
        .listStyle(.insetGrouped)
    }
}

private struct LibrarySummary: View {
    let progress: MonthProgress

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Library \(progress.percent)% Sorted")
                .font(.headline)
            Text(
                "\(progress.decided.formatted()) of \(progress.total.formatted()) \(progress.total == 1 ? "item" : "items") sorted · \(progress.toDelete == 0 ? "none" : progress.toDelete.formatted()) marked for deletion"
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .monospacedDigit()
            ProgressView(value: progress.fraction)
                .tint(progress.isComplete ? .green : .accentColor)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

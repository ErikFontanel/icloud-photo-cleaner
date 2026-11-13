import SwiftUI

struct MonthDoneSheet: View {
    let month: MonthKey
    let progress: MonthProgress
    let ids: [String]
    let nextMonth: MonthKey?
    let onNextMonth: (MonthKey) -> Void

    @Environment(DecisionStore.self) private var store
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var bytesToFree: Int64?

    var body: some View {
        ScrollView {
            content
        }
        .scrollBounceBehavior(.basedOnSize)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task(id: markedIDs) {
            // One fetch on the main actor; the detached per-asset version never finished in a Zeno run (SIFT-010).
            bytesToFree = AssetDetails.totalByteCount(of: markedIDs)
        }
    }

    private var markedIDs: [String] { ids.filter { store.verdict(for: $0) == .delete } }

    private var content: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.largeTitle)
                .imageScale(.large)
                .symbolRenderingMode(.multicolor)
                .symbolEffect(.bounce, options: .nonRepeating)
                .accessibilityHidden(true)

            VStack(spacing: 6) {
                Text("\(month.title) Is Sorted")
                    .font(.title2.bold())
                Text("The photos you marked are in the “\(DeletionAlbumTitle.value)” album. Nothing has been deleted.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            // Three across while they fit; stacked at large text sizes.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 10) { stats }
                VStack(spacing: 10) { stats }
            }

            VStack(spacing: 4) {
                Button {
                    openURL(URL(string: "photos-redirect://")!)
                } label: {
                    Text("Open Photos").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)

                if let nextMonth {
                    Button("Next Month: \(nextMonth.title)") { onNextMonth(nextMonth) }
                        .controlSize(.large)
                } else {
                    Button("Done") { dismiss() }
                        .controlSize(.large)
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 28)
        .padding(.bottom, 12)
    }

    @ViewBuilder private var stats: some View {
        stat(value: (progress.total - progress.toDelete).formatted(), label: "Kept")
        stat(value: progress.toDelete.formatted(), label: "To Delete")
        stat(value: bytesToFree.map { $0.formatted(.byteCount(style: .file)) } ?? "–", label: "To Free")
    }

    private func stat(value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title3.bold())
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(.background.secondary, in: .rect(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

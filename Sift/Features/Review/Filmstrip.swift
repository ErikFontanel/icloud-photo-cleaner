import SwiftUI

/// Photos-style strip of thumbnails. Dots show decisions; tap to jump.
struct Filmstrip: View {
    let ids: [String]
    let currentID: String?
    let onSelect: (String) -> Void

    @Environment(DecisionStore.self) private var store

    @State private var width: CGFloat = 0

    var body: some View {
        ScrollViewReader { reader in
            ScrollView(.horizontal) {
                LazyHStack(spacing: 4) {
                    ForEach(Array(ids.enumerated()), id: \.element) { position, id in
                        Button {
                            onSelect(id)
                        } label: {
                            cell(id)
                        }
                        .buttonStyle(.plain)
                        .id(id)
                        .accessibilityLabel("Item \(position + 1) of \(ids.count), \(label(for: id))")
                        .accessibilityAddTraits(id == currentID ? .isSelected : [])
                    }
                }
                .padding(.vertical, 4)
            }
            .scrollIndicators(.hidden)
            // Like Photos: the current thumbnail can sit in the middle, even at either end.
            .contentMargins(.horizontal, max(16, width / 2 - 20), for: .scrollContent)
            .onGeometryChange(for: CGFloat.self) {
                $0.size.width
            } action: {
                width = $0
            }
            .onAppear { scroll(reader, animated: false) }
            .onChange(of: currentID) { scroll(reader, animated: true) }
        }
    }

    private func cell(_ id: String) -> some View {
        let isCurrent = id == currentID
        return Thumbnail(id: id)
            .frame(width: isCurrent ? 40 : 30, height: 44)
            .clipShape(.rect(cornerRadius: 5, style: .continuous))
            .overlay {
                if isCurrent {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .strokeBorder(.tint, lineWidth: 2)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if let verdict = store.verdict(for: id) {
                    // Glyph as well as colour, so the state reads without telling red from green.
                    Image(systemName: verdict == .delete ? "trash.circle.fill" : "checkmark.circle.fill")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white, verdict == .delete ? Color.red : Color.green.mix(with: .black, by: 0.2))
                        .background(Circle().fill(.white).padding(1))
                        .offset(x: 3, y: 3)
                }
            }
            .animation(.smooth(duration: 0.25), value: isCurrent)
    }

    private func scroll(_ reader: ScrollViewProxy, animated: Bool) {
        guard let currentID else { return }
        if animated {
            withAnimation(.smooth) { reader.scrollTo(currentID, anchor: .center) }
        } else {
            reader.scrollTo(currentID, anchor: .center)
        }
    }

    private func label(for id: String) -> String {
        switch store.verdict(for: id) {
        case .delete: "Marked for deletion"
        case .keep: "Kept"
        case nil: "Not sorted yet"
        }
    }
}

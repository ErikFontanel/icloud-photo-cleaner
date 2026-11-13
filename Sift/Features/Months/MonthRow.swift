import SwiftUI

struct MonthRow: View {
    let month: MonthKey
    let coverID: String?
    let progress: MonthProgress
    @ScaledMetric(relativeTo: .subheadline) private var percentWidth: CGFloat = 40
    @ScaledMetric(relativeTo: .body) private var thumbSize: CGFloat = 44

    var body: some View {
        HStack(spacing: 12) {
            Thumbnail(id: coverID)
                .frame(width: thumbSize, height: thumbSize)
                .clipShape(.rect(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                Text(month.title)
                    .font(.body)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }

            Spacer(minLength: 8)

            if progress.isComplete {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(.white, .green)
            } else {
                ProgressRing(fraction: progress.fraction)
                    .frame(width: 24, height: 24)
            }
            Text("\(progress.percent)%")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .frame(minWidth: percentWidth, alignment: .trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(month.titleWithYear)
        .accessibilityValue("\(progress.percent)% sorted, \(detail)")
    }

    private var detail: String {
        let items = progress.total == 1 ? "1 item" : "\(progress.total.formatted()) items"
        return progress.toDelete > 0 ? "\(items) · \(progress.toDelete.formatted()) to delete" : items
    }
}

struct Thumbnail: View {
    let id: String?
    @State private var image: UIImage?
    @Environment(\.displayScale) private var scale

    var body: some View {
        Rectangle()
            .fill(.quaternary)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                }
            }
            .clipped()
            .task(id: id) {
                guard let id else { return }
                for await next in ImageLoader.shared.images(
                    for: id, size: CGSize(width: 88 * scale, height: 88 * scale), contentMode: .aspectFill)
                {
                    image = next
                }
            }
    }
}

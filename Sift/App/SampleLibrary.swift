#if DEBUG
    import Photos
    import UIKit

    /// Simulator-only test data. Launch with `-seed-sample-library` to add dated sample photos once,
    /// and with `-empty-deletion-album` to start a UI test with an empty album.
    enum SampleLibrary {
        static func prepareIfRequested(library: PhotoLibrary) async {
            let arguments = ProcessInfo.processInfo.arguments
            guard library.hasFullAccess else { return }
            // Checks the library itself, not a flag, so a reinstall never adds the samples twice.
            if arguments.contains("-seed-sample-library"), !isSeeded() {
                try? await seed()
            }
            if arguments.contains("-empty-deletion-album"), let members = DeletionAlbum().memberIDs() {
                try? await DeletionAlbum().remove(Array(members))
            }
        }

        private nonisolated static let months: [(year: Int, month: Int, count: Int)] = [
            (2026, 10, 12), (2026, 9, 8), (2026, 8, 6), (2025, 12, 5),
        ]

        /// True when the first sample photo is already in the library.
        private static func isSeeded() -> Bool {
            guard let first = sampleDates().first else { return true }
            let options = PHFetchOptions()
            options.predicate = NSPredicate(format: "creationDate == %@", first as NSDate)
            return PHAsset.fetchAssets(with: .image, options: options).count > 0
        }

        private nonisolated static func sampleDates() -> [Date] {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = .current
            return months.flatMap { entry in
                (0..<entry.count).map { i in
                    calendar.date(from: DateComponents(year: entry.year, month: entry.month, day: 1 + i * 2, hour: 9 + i % 8))!
                }
            }
        }

        // PhotoKit runs change blocks on its own queue, so this must not be main-actor isolated.
        private nonisolated static func seed() async throws {
            var images: [(Data, Date)] = []
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = .current
            for (m, entry) in months.enumerated() {
                for i in 0..<entry.count {
                    let date = calendar.date(from: DateComponents(year: entry.year, month: entry.month, day: 1 + i * 2, hour: 9 + i % 8))!
                    let hue = (CGFloat(m) * 0.23 + CGFloat(i) * 0.07).truncatingRemainder(dividingBy: 1)
                    images.append((render(hue: hue), date))
                }
            }
            let payload = UncheckedBox(images)
            try await PHPhotoLibrary.shared().performChanges {
                for (data, date) in payload.value ?? [] {
                    let request = PHAssetCreationRequest.forAsset()
                    request.addResource(with: .photo, data: data, options: nil)
                    request.creationDate = date
                }
            }
        }

        private nonisolated static func render(hue: CGFloat) -> Data {
            let size = CGSize(width: 1200, height: 1600)
            let image = UIGraphicsImageRenderer(size: size).image { context in
                let colors =
                    [
                        UIColor(hue: hue, saturation: 0.55, brightness: 0.95, alpha: 1).cgColor,
                        UIColor(hue: (hue + 0.12).truncatingRemainder(dividingBy: 1), saturation: 0.7, brightness: 0.55, alpha: 1).cgColor,
                    ] as CFArray
                let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
                context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: [])
            }
            return image.jpegData(compressionQuality: 0.8)!
        }
    }
#endif

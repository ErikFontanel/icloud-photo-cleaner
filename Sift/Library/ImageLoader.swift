import AVFoundation
import Photos
import UIKit

/// Loads thumbnails, full-screen images and videos, and prefetches what comes next.
final class ImageLoader {
    static let shared = ImageLoader()

    private let manager = PHCachingImageManager()
    private var cached: (ids: [String], size: CGSize)?

    func asset(_ id: String) -> PHAsset? {
        PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject
    }

    /// Yields a fast low-quality image first, then the final image. Downloads from iCloud when needed.
    func images(for id: String, size: CGSize, contentMode: PHImageContentMode = .aspectFit) -> AsyncStream<UIImage> {
        AsyncStream { continuation in
            guard let asset = asset(id) else {
                continuation.finish()
                return
            }
            let options = PHImageRequestOptions()
            options.deliveryMode = .opportunistic
            options.isNetworkAccessAllowed = true
            options.resizeMode = .fast
            let request = manager.requestImage(for: asset, targetSize: size, contentMode: contentMode, options: options) { image, info in
                if let image { continuation.yield(image) }
                let degraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                let failed = info?[PHImageErrorKey] != nil || (info?[PHImageCancelledKey] as? Bool) == true
                if !degraded || failed { continuation.finish() }
            }
            let manager = manager
            continuation.onTermination = { _ in manager.cancelImageRequest(request) }
        }
    }

    func playerItem(for id: String) async -> AVPlayerItem? {
        guard let asset = asset(id) else { return nil }
        let box = await Self.requestAVAsset(asset, manager: manager)
        return box.value.map(AVPlayerItem.init(asset:))
    }

    // PhotoKit calls this handler on a background queue, so it must not be main-actor isolated.
    private nonisolated static func requestAVAsset(_ asset: PHAsset, manager: PHImageManager) async -> UncheckedBox<AVAsset> {
        let options = PHVideoRequestOptions()
        options.isNetworkAccessAllowed = true
        options.deliveryMode = .mediumQualityFormat
        return await withCheckedContinuation { continuation in
            manager.requestAVAsset(forVideo: asset, options: options) { avAsset, _, _ in
                continuation.resume(returning: UncheckedBox(avAsset))
            }
        }
    }

    /// Keeps the next few full-screen images warm so swiping never waits.
    func prefetch(_ ids: [String], size: CGSize) {
        if let cached, cached.ids == ids, cached.size == size { return }
        if let cached {
            manager.stopCachingImages(for: assets(cached.ids), targetSize: cached.size, contentMode: .aspectFit, options: nil)
        }
        let options = PHImageRequestOptions()
        options.isNetworkAccessAllowed = true
        manager.startCachingImages(for: assets(ids), targetSize: size, contentMode: .aspectFit, options: options)
        cached = (ids, size)
    }

    private func assets(_ ids: [String]) -> [PHAsset] {
        var list: [PHAsset] = []
        PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil).enumerateObjects { asset, _, _ in list.append(asset) }
        return list
    }
}

nonisolated struct UncheckedBox<Value>: @unchecked Sendable {
    let value: Value?
    init(_ value: Value?) { self.value = value }
}

nonisolated struct AssetDetails: Equatable, Sendable {
    let date: Date?
    let isVideo: Bool
    let duration: TimeInterval
    let byteCount: Int64?

    init?(id: String) {
        guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else { return nil }
        date = asset.creationDate
        isVideo = asset.mediaType == .video
        duration = asset.duration
        byteCount = Self.byteCount(of: asset)
    }

    /// Total size of the given assets, fetched in one call.
    static func totalByteCount(of ids: [String]) -> Int64 {
        guard !ids.isEmpty else { return 0 }
        var total: Int64 = 0
        PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil).enumerateObjects { asset, _, _ in
            total += byteCount(of: asset) ?? 0
        }
        return total
    }

    private static func byteCount(of asset: PHAsset) -> Int64? {
        let resources = PHAssetResource.assetResources(for: asset)
        let primary = resources.first { $0.type == .photo || $0.type == .video } ?? resources.first
        // `fileSize` is not public API, but it is the only way to read a size without downloading.
        return (primary?.value(forKey: "fileSize") as? NSNumber)?.int64Value
    }
}

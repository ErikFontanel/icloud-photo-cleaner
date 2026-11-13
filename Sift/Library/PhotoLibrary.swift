import Observation
import Photos
import UIKit

@Observable
final class PhotoLibrary {
    private(set) var status: PHAuthorizationStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    private(set) var index = MonthIndex()
    private(set) var hasLoaded = false
    /// Called after every reload with all asset IDs, so decisions can be reconciled.
    var onReload: ((Set<String>) -> Void)?

    private let observer = ChangeObserver()

    init() {
        observer.onLibraryChange = { [weak self] in
            Task { await self?.reload() }
        }
    }

    var hasFullAccess: Bool { status == .authorized }

    func requestAccess() async {
        status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        if hasFullAccess { await reload() }
    }

    func refreshStatus() {
        status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    }

    func reload() async {
        guard hasFullAccess else { return }
        observer.register()
        let items = await observer.fetchItems()
        index = MonthIndex.build(from: items)
        hasLoaded = true
        onReload?(Set(items.map(\.id)))
    }
}

/// Fetches the library off the main thread and reports changes that add or remove assets.
private nonisolated final class ChangeObserver: NSObject, PHPhotoLibraryChangeObserver, @unchecked Sendable {
    private let lock = NSLock()
    private var fetchResult: PHFetchResult<PHAsset>?
    private var isRegistered = false
    @MainActor var onLibraryChange: (() -> Void)?

    func register() {
        lock.withLock {
            guard !isRegistered else { return }
            isRegistered = true
            PHPhotoLibrary.shared().register(self)
        }
    }

    func fetchItems() async -> [LibraryItem] {
        await Task.detached(priority: .userInitiated) { [self] in
            let options = PHFetchOptions()
            options.predicate = NSPredicate(
                format: "mediaType == %d OR mediaType == %d",
                PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue
            )
            options.includeHiddenAssets = false
            let result = PHAsset.fetchAssets(with: options)
            lock.withLock { fetchResult = result }
            var items: [LibraryItem] = []
            items.reserveCapacity(result.count)
            result.enumerateObjects { asset, _, _ in
                items.append(LibraryItem(id: asset.localIdentifier, date: asset.creationDate ?? .distantPast))
            }
            return items
        }.value
    }

    func photoLibraryDidChange(_ changeInstance: PHChange) {
        guard let result = lock.withLock({ fetchResult }),
            let details = changeInstance.changeDetails(for: result)
        else { return }
        // Album edits (every swipe) arrive as "changed" objects; only reload when assets come or go.
        guard !details.insertedObjects.isEmpty || !details.removedObjects.isEmpty else {
            lock.withLock { fetchResult = details.fetchResultAfterChanges }
            return
        }
        Task { @MainActor in onLibraryChange?() }
    }
}

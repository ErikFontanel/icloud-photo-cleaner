import Photos

/// The "Sift – To Delete" album. Sift only adds and removes album members; it never deletes assets.
final class DeletionAlbum: DeletionAlbumSyncing {
    private let defaultsKey = "deletionAlbumID"

    func add(_ ids: [String]) async throws {
        let albumID = try await ensureAlbumID()
        try await PhotoKitChanges.addAssets(ids, toAlbum: albumID)
    }

    func remove(_ ids: [String]) async throws {
        guard let albumID = existingAlbumID() else { return }
        try await PhotoKitChanges.removeAssets(ids, fromAlbum: albumID)
    }

    /// Asset IDs in the album, or `nil` when the album doesn't exist.
    func memberIDs() -> Set<String>? {
        guard let albumID = existingAlbumID(),
            let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [albumID], options: nil).firstObject
        else { return nil }
        var ids = Set<String>()
        PHAsset.fetchAssets(in: album, options: nil).enumerateObjects { asset, _, _ in ids.insert(asset.localIdentifier) }
        return ids
    }

    private func existingAlbumID() -> String? {
        if let stored = UserDefaults.standard.string(forKey: defaultsKey),
            PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [stored], options: nil).firstObject != nil
        {
            return stored
        }
        let options = PHFetchOptions()
        options.predicate = NSPredicate(format: "title == %@", DeletionAlbumTitle.value)
        let found = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .albumRegular, options: options).firstObject
        if let found { UserDefaults.standard.set(found.localIdentifier, forKey: defaultsKey) }
        return found?.localIdentifier
    }

    private func ensureAlbumID() async throws -> String {
        if let id = existingAlbumID() { return id }
        let id = try await PhotoKitChanges.createAlbum(titled: DeletionAlbumTitle.value)
        UserDefaults.standard.set(id, forKey: defaultsKey)
        return id
    }
}

/// PhotoKit change blocks run on a background queue, so they live outside the main actor.
nonisolated enum PhotoKitChanges {
    private final class Box: @unchecked Sendable { var value: String? }

    static func createAlbum(titled title: String) async throws -> String {
        let box = Box()
        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: title)
            box.value = request.placeholderForCreatedAssetCollection.localIdentifier
        }
        return box.value!
    }

    static func addAssets(_ ids: [String], toAlbum albumID: String) async throws {
        try await PHPhotoLibrary.shared().performChanges {
            guard let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [albumID], options: nil).firstObject else {
                return
            }
            let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
            PHAssetCollectionChangeRequest(for: album)?.addAssets(assets)
        }
    }

    static func removeAssets(_ ids: [String], fromAlbum albumID: String) async throws {
        try await PHPhotoLibrary.shared().performChanges {
            guard let album = PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [albumID], options: nil).firstObject else {
                return
            }
            let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
            PHAssetCollectionChangeRequest(for: album)?.removeAssets(assets)
        }
    }
}

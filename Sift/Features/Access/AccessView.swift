import Photos
import SwiftUI

struct AccessView: View {
    @Environment(PhotoLibrary.self) private var library
    @Environment(\.openURL) private var openURL

    var body: some View {
        switch library.status {
        case .notDetermined:
            ContentUnavailableView {
                Label("Sort Your Library", systemImage: "photo.stack")
            } description: {
                Text(
                    "Swipe left on photos you don't need and right on the ones you keep. Sift adds the left swipes to a “\(DeletionAlbumTitle.value)” album so you can delete them yourself in Photos. Sift never deletes anything."
                )
            } actions: {
                Button("Continue") {
                    Task { await library.requestAccess() }
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            }
        default:
            ContentUnavailableView {
                Label(
                    library.status == .limited ? "Sift Needs Full Access" : "No Access to Photos",
                    systemImage: "lock.rectangle.stack"
                )
            } description: {
                Text(
                    library.status == .limited
                        ? "With access to only some photos, Sift can't show whole months. Choose Full Access in Settings."
                        : "Sift needs access to your photo library to show your photos. Allow Full Access in Settings.")
            } actions: {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            }
        }
    }
}

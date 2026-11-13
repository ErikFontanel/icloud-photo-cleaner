// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "sift-vision",
    platforms: [.macOS(.v15)],
    targets: [.executableTarget(name: "sift-vision"), .executableTarget(name: "sift-places")]
)

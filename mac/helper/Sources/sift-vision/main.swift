// Reads image paths from stdin, one per line. Writes one JSON object per line:
// {"path", "score", "utility", "fp", "classes", "faces", "face_q"} where fp is the Vision feature print as base64 float32
// and classes maps each identifier in $SIFT_CLASSES (comma-separated) to its classifier confidence; or {"path", "error"}.
import Foundation
import Vision

let wanted = Set((ProcessInfo.processInfo.environment["SIFT_CLASSES"] ?? "").split(separator: ",").map(String.init))

func analyse(_ path: String) -> [String: Any] {
    let handler = VNImageRequestHandler(url: URL(fileURLWithPath: path))
    let fp = VNGenerateImageFeaturePrintRequest()
    let ae = VNCalculateImageAestheticsScoresRequest()
    let cl = VNClassifyImageRequest()
    let fq = VNDetectFaceCaptureQualityRequest()
    do {
        try handler.perform([fp, ae, cl, fq])
        guard let f = fp.results?.first, let a = ae.results?.first else { return ["path": path, "error": "no result"] }
        var classes: [String: Float] = [:]
        for c in cl.results ?? [] where wanted.contains(c.identifier) { classes[c.identifier] = c.confidence }
        // face_q: the weakest face's capture quality (0...1), so one closed eye or blurred face lowers the whole shot.
        let faces = fq.results ?? []
        let faceQ: Any = faces.compactMap { $0.faceCaptureQuality }.min() ?? NSNull()
        return [
            "path": path, "score": a.overallScore, "utility": a.isUtility, "classes": classes, "faces": faces.count, "face_q": faceQ,
            "fp": f.data.base64EncodedString(), "fp_type": f.elementType == .float ? "float32" : "float64",
        ]
    } catch {
        return ["path": path, "error": "\(error)"]
    }
}

while let line = readLine() {
    let path = line.trimmingCharacters(in: .whitespaces)
    if path.isEmpty { continue }
    // Drain per image: without it memory grows ~1.6 MB per image and Vision fails after ~16k images.
    autoreleasepool {
        let out = try! JSONSerialization.data(withJSONObject: analyse(path))
        FileHandle.standardOutput.write(out)
        FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    }
}

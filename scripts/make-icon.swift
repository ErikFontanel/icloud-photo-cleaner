// Renders the Sift app icons: swift scripts/make-icon.swift <output-dir>
import AppKit

let out = CommandLine.arguments[1]
let size = 1024.0

func render(_ name: String, background: [NSColor]?, card: NSColor, back: NSColor, mark: NSColor) {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ctx = NSGraphicsContext.current!.cgContext
    if let background {
        NSGradient(colors: background)!.draw(in: NSRect(x: 0, y: 0, width: size, height: size), angle: -90)
    }
    func cardPath(rotation: CGFloat, dx: CGFloat) -> NSBezierPath {
        let rect = NSRect(x: -230, y: -300, width: 460, height: 600)
        let path = NSBezierPath(roundedRect: rect, xRadius: 70, yRadius: 70)
        var t = AffineTransform(translationByX: size / 2 + dx, byY: size / 2 - 10)
        t.rotate(byDegrees: rotation)
        path.transform(using: t)
        return path
    }
    ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 40, color: NSColor.black.withAlphaComponent(0.25).cgColor)
    back.setFill()
    cardPath(rotation: 12, dx: 70).fill()
    card.setFill()
    cardPath(rotation: -6, dx: -40).fill()
    ctx.setShadow(offset: .zero, blur: 0, color: nil)
    let check = NSBezierPath()
    check.move(to: NSPoint(x: 360, y: 500))
    check.line(to: NSPoint(x: 460, y: 400))
    check.line(to: NSPoint(x: 640, y: 610))
    var t = AffineTransform(translationByX: 512 - 40, byY: 502)
    t.rotate(byDegrees: -6)
    t.translate(x: -500, y: -505)
    check.transform(using: t)
    check.lineWidth = 64
    check.lineCapStyle = .round
    check.lineJoinStyle = .round
    mark.setStroke()
    check.stroke()
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(out)/\(name)"))
}

let blue = NSColor(srgbRed: 0.04, green: 0.52, blue: 1.0, alpha: 1)
render(
    "icon-light.png",
    background: [NSColor(srgbRed: 0.35, green: 0.78, blue: 1, alpha: 1), NSColor(srgbRed: 0.0, green: 0.45, blue: 0.95, alpha: 1)],
    card: .white, back: NSColor.white.withAlphaComponent(0.55), mark: blue)
render(
    "icon-dark.png",
    background: [NSColor(white: 0.16, alpha: 1), NSColor(white: 0.05, alpha: 1)],
    card: NSColor(white: 0.22, alpha: 1), back: NSColor(white: 0.14, alpha: 1), mark: NSColor(srgbRed: 0.25, green: 0.62, blue: 1, alpha: 1)
)
render(
    "icon-tinted.png",
    background: [NSColor.black, NSColor.black],
    card: NSColor(white: 0.85, alpha: 1), back: NSColor(white: 0.45, alpha: 1), mark: NSColor.black)

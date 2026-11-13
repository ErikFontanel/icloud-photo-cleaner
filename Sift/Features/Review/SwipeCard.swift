import AVFoundation
import SwiftUI

/// Swipe physics shared by the card and its tests.
nonisolated enum SwipePhysics {
    /// Fraction of the card width the projected end point must pass to commit.
    static let commitFraction: CGFloat = 0.35
    static let maxRotation: Double = 10
    static let flyOffFraction: CGFloat = 1.4

    /// Decides from where the gesture is going, not where it stopped, so a short fast flick commits.
    static func verdict(translation: CGFloat, predictedEnd: CGFloat, width: CGFloat) -> Verdict? {
        let threshold = width * commitFraction
        guard abs(predictedEnd) > threshold else { return nil }
        // Moving back toward the centre at release cancels, even past the threshold.
        let momentum = predictedEnd - translation
        if translation != 0, momentum != 0, (momentum > 0) != (translation > 0) { return nil }
        return predictedEnd < 0 ? .delete : .keep
    }

    /// Progressive resistance past a boundary instead of a hard stop.
    static func rubberBand(_ overshoot: CGFloat, dimension: CGFloat, constant: CGFloat = 0.55) -> CGFloat {
        guard dimension > 0 else { return 0 }
        return (overshoot * dimension * constant) / (dimension + constant * abs(overshoot))
    }

    /// Spring velocity relative to the distance left, as SwiftUI's `initialVelocity` expects.
    static func relativeVelocity(_ velocity: CGFloat, from current: CGFloat, to target: CGFloat) -> Double {
        let distance = target - current
        guard abs(distance) > 1 else { return 0 }
        return Double(velocity / distance)
    }
}

/// Where a card is and how it is tilted when it leaves the finger.
struct CardPose: Equatable {
    var offset: CGSize = .zero
    var rotation: Double = 0
    var anchor: UnitPoint = .center
    var velocity: CGSize = .zero
}

/// The interactive top card.
struct SwipeCard: View {
    let assetID: String
    let size: CGSize
    /// Horizontal start position when the card returns from a side (undo, previous).
    let entryOffset: CGFloat
    @Binding var dragProgress: CGFloat
    let onCommit: (Verdict, CardPose) -> Void

    @State private var offset: CGSize = .zero
    @State private var grabSign: Double = 1
    @State private var isDragging = false
    @State private var opacity: Double = 1
    @State private var pendingVerdict: Verdict?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        CardContent(assetID: assetID, size: size, isTop: true, progress: dragProgress)
            .onGeometryChange(for: CGFloat.self) {
                $0.frame(in: .global).midY
            } action: {
                globalMidY = $0
            }
            .opacity(opacity)
            .rotationEffect(.degrees(rotation), anchor: anchor)
            .offset(offset)
            .gesture(drag)
            // Ticks when releasing now would commit: the same rule the release uses.
            .sensoryFeedback(.selection, trigger: pendingVerdict) { _, new in new != nil }
            .onAppear(perform: enter)
            .accessibilityAction(named: "Mark for Deletion") { commitWithoutDrag(.delete) }
            .accessibilityAction(named: "Keep") { commitWithoutDrag(.keep) }
    }

    /// Grabbed in the top half, the card pivots around its bottom edge, like a real card held there.
    private var anchor: UnitPoint { grabSign > 0 ? .bottom : .top }

    private var rotation: Double {
        guard size.width > 0 else { return 0 }
        return Double(offset.width / size.width) * SwipePhysics.maxRotation * grabSign
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 10, coordinateSpace: .global)
            .onChanged { value in
                if !isDragging {
                    isDragging = true
                    grabSign = value.startLocation.y < globalMidY ? 1 : -1
                }
                // A very short spring: effectively 1:1, but it blends from a running snap-back instead of jumping.
                withAnimation(.interactiveSpring(response: 0.08, dampingFraction: 0.9)) {
                    offset = CGSize(
                        width: value.translation.width,
                        height: SwipePhysics.rubberBand(value.translation.height, dimension: size.height)
                    )
                }
                dragProgress = max(-1, min(1, value.translation.width / (size.width * SwipePhysics.commitFraction)))
                pendingVerdict = verdict(for: value)
            }
            .onEnded { value in
                isDragging = false
                pendingVerdict = nil
                if let verdict = verdict(for: value) {
                    onCommit(verdict, CardPose(offset: offset, rotation: rotation, anchor: anchor, velocity: value.velocity))
                } else {
                    snapBack(velocity: value.velocity)
                }
            }
    }

    @State private var globalMidY: CGFloat = 0

    private func verdict(for value: DragGesture.Value) -> Verdict? {
        SwipePhysics.verdict(
            translation: value.translation.width,
            predictedEnd: value.predictedEndTranslation.width,
            width: size.width
        )
    }

    private func snapBack(velocity: CGSize) {
        // Bounce only when the release carried momentum, and never with Reduce Motion.
        let flicked = abs(velocity.width) > 300 && !reduceMotion
        let vx = SwipePhysics.relativeVelocity(velocity.width, from: offset.width, to: 0)
        let vy = SwipePhysics.relativeVelocity(velocity.height, from: offset.height, to: 0)
        withAnimation(.interpolatingSpring(duration: 0.4, bounce: flicked ? 0.2 : 0, initialVelocity: vx)) {
            offset.width = 0
            dragProgress = 0
        }
        withAnimation(.interpolatingSpring(duration: 0.4, bounce: 0, initialVelocity: vy)) {
            offset.height = 0
        }
    }

    private func enter() {
        guard entryOffset != 0 else { return }
        if reduceMotion {
            opacity = 0
            withAnimation(.easeOut(duration: 0.2)) { opacity = 1 }
        } else {
            offset = CGSize(width: entryOffset, height: 0)
            withAnimation(.smooth(duration: 0.35)) { offset = .zero }
        }
    }

    private func commitWithoutDrag(_ verdict: Verdict) {
        onCommit(verdict, CardPose(offset: offset, rotation: rotation, anchor: anchor))
    }
}

/// A card that has been decided (or navigated away from) and is leaving the screen.
struct Departure: Identifiable, Equatable {
    let id = UUID()
    let assetID: String
    let verdict: Verdict?
    let pose: CardPose
    /// -1 leaves to the left, 1 to the right.
    let direction: CGFloat
}

struct DepartingCard: View {
    let departure: Departure
    let size: CGSize
    let onFinished: () -> Void

    @State private var offset: CGSize
    @State private var rotation: Double
    @State private var opacity: Double = 1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(departure: Departure, size: CGSize, onFinished: @escaping () -> Void) {
        self.departure = departure
        self.size = size
        self.onFinished = onFinished
        _offset = State(initialValue: departure.pose.offset)
        _rotation = State(initialValue: departure.pose.rotation)
    }

    var body: some View {
        CardContent(
            assetID: departure.assetID,
            size: size,
            isTop: false,
            progress: departure.verdict == nil ? 0 : departure.direction
        )
        .opacity(opacity)
        .rotationEffect(.degrees(rotation), anchor: departure.pose.anchor)
        .offset(offset)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear(perform: leave)
    }

    private func leave() {
        if reduceMotion {
            withAnimation(.easeOut(duration: 0.2)) {
                opacity = 0
            } completion: {
                onFinished()
            }
            return
        }
        let target = departure.direction * size.width * SwipePhysics.flyOffFraction
        // Keep tilting the way the finger tilted it; never swing back through upright.
        let tiltSign: Double = departure.pose.rotation == 0 ? Double(departure.direction) : (departure.pose.rotation > 0 ? 1 : -1)
        // Each axis gets its own spring and velocity, so x continues at the finger's speed without dragging y along.
        let vx = SwipePhysics.relativeVelocity(departure.pose.velocity.width, from: offset.width, to: target)
        withAnimation(.interpolatingSpring(duration: 0.45, bounce: 0, initialVelocity: vx)) {
            offset.width = target
        } completion: {
            onFinished()
        }
        guard departure.verdict != nil else { return }
        let targetY = offset.height + size.height * 0.05
        let vy = SwipePhysics.relativeVelocity(departure.pose.velocity.height, from: offset.height, to: targetY)
        withAnimation(.interpolatingSpring(duration: 0.45, bounce: 0, initialVelocity: vy)) {
            offset.height = targetY
        }
        withAnimation(.smooth(duration: 0.45)) {
            rotation = tiltSign * SwipePhysics.maxRotation * 1.5
        }
    }
}

/// The photo or video inside a card, with the decision tint and stamp.
struct CardContent: View {
    let assetID: String
    let size: CGSize
    let isTop: Bool
    /// -1 (delete) … 1 (keep); drives the tint and stamp.
    let progress: CGFloat

    @State private var image: UIImage?
    @State private var details: AssetDetails?
    @Environment(\.displayScale) private var scale

    var body: some View {
        ZStack {
            Rectangle().fill(.background.secondary)
            if let image {
                // Whole photo, letterboxed like Photos, so nothing is cropped away before you decide.
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(width: size.width, height: size.height)
            } else {
                ProgressView()
            }
            if isTop, details?.isVideo == true {
                LoopingVideo(assetID: assetID)
                    .frame(width: size.width, height: size.height)
            }
            tint
        }
        .frame(width: size.width, height: size.height)
        .overlay(alignment: .bottomLeading) { meta }
        .overlay(alignment: progress < 0 ? .topTrailing : .topLeading) { stamp }
        .clipShape(.rect(cornerRadius: 28, style: .continuous))
        .shadow(color: .black.opacity(isTop ? 0.18 : 0.1), radius: isTop ? 18 : 8, y: 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(.isImage)
        .task(id: assetID) {
            details = AssetDetails(id: assetID)
            let pixels = CGSize(width: size.width * scale, height: size.height * scale)
            for await next in ImageLoader.shared.images(for: assetID, size: pixels) {
                image = next
            }
        }
    }

    private var tint: some View {
        Rectangle()
            .fill(progress < 0 ? Color.red : Color.green)
            .opacity(Double(min(abs(progress), 1)) * 0.28)
            .allowsHitTesting(false)
    }

    @ViewBuilder private var stamp: some View {
        let amount = min(abs(progress), 1)
        if amount > 0 {
            stampLabel(amount)
        }
    }

    private func stampLabel(_ amount: CGFloat) -> some View {
        Label(progress < 0 ? "Delete" : "Keep", systemImage: progress < 0 ? "trash.fill" : "checkmark")
            .font(.title3.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            // System green is too light for white text; darken it to keep 3:1 contrast.
            .background(progress < 0 ? Color.red : Color.green.mix(with: .black, by: 0.35), in: .capsule)
            .scaleEffect(0.8 + 0.2 * amount)
            .opacity(Double(amount))
            .padding(20)
            .accessibilityHidden(true)
    }

    @ViewBuilder private var meta: some View {
        if isTop, let details {
            HStack(spacing: 6) {
                if details.isVideo {
                    Image(systemName: "video.fill")
                    Text(Duration.seconds(details.duration).formatted(.time(pattern: .minuteSecond)))
                }
                if let date = details.date {
                    Text(date.formatted(.dateTime.month(.abbreviated).day().hour().minute()))
                }
                if let bytes = details.byteCount {
                    Text(bytes.formatted(.byteCount(style: .file)))
                }
            }
            .font(.footnote.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            // A solid dark layer keeps the label readable over any photo; glass lets bright photos through.
            .background(.black.opacity(0.6), in: .capsule)
            .padding(14)
            .accessibilityHidden(true)
        }
    }

    private var accessibilityText: String {
        guard let details else { return "Photo" }
        var parts = [details.isVideo ? "Video" : "Photo"]
        if let date = details.date { parts.append(date.formatted(date: .long, time: .shortened)) }
        if details.isVideo { parts.append(Duration.seconds(details.duration).formatted(.units(allowed: [.minutes, .seconds]))) }
        if let bytes = details.byteCount { parts.append(bytes.formatted(.byteCount(style: .file))) }
        return parts.joined(separator: ", ")
    }
}

/// Muted, looping video for the top card.
private struct LoopingVideo: UIViewRepresentable {
    let assetID: String

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.isUserInteractionEnabled = false
        Task { @MainActor in
            guard let item = await ImageLoader.shared.playerItem(for: assetID) else { return }
            view.play(item)
        }
        return view
    }

    func updateUIView(_ uiView: PlayerView, context: Context) {}

    static func dismantleUIView(_ uiView: PlayerView, coordinator: ()) {
        uiView.stop()
    }

    final class PlayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        private var player: AVQueuePlayer?
        private var looper: AVPlayerLooper?

        func play(_ item: AVPlayerItem) {
            let player = AVQueuePlayer()
            player.isMuted = true
            looper = AVPlayerLooper(player: player, templateItem: item)
            (layer as? AVPlayerLayer)?.player = player
            (layer as? AVPlayerLayer)?.videoGravity = .resizeAspect
            player.play()
            self.player = player
        }

        func stop() {
            player?.pause()
            looper = nil
            player = nil
        }
    }
}

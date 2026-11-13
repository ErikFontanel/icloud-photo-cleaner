// Apple's ease-out curve; a short cross-fade instead of movement when the system asks for reduced motion.
export const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const DUR = 420;
const reduce = matchMedia("(prefers-reduced-motion: reduce)");
export const still = () => reduce.matches;
export type Box = { left: number; top: number; width: number; height: number };
const QUIET = 150; // the reduced-motion cross-fade

const between = (a: Box, b: Box) => `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
const appear = (node: Element) => node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: QUIET, easing: "ease-out" });
const vanish = (node: Element) => node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: QUIET, easing: "ease-out", fill: "forwards" });
// A flight out held its end with fill: forwards. Reopened mid-close (Space twice), that fill would take over again
// once the new flight ends and leave the photo shrunk or invisible: drop it first.
const settle = (node: Element) => {
  for (const a of node.getAnimations()) a.cancel();
};

// FLIP: draw node where `from` was, then let it glide to where the layout put it.
export function flip(node: Element | null, from: Box | undefined) {
  if (node) settle(node);
  const to = node?.getBoundingClientRect();
  if (!node || !to?.width || !from?.width) return;
  if (still()) return appear(node);
  node.animate(
    [
      { transformOrigin: "0 0", transform: between(from, to) },
      { transformOrigin: "0 0", transform: "none" },
    ],
    { duration: DUR, easing: EASE },
  );
}

// The way back: node flies from where it is onto `to` (its thumbnail), or shrinks away without one. Resolves when done.
export function flyBack(node: Element | null, to: Box | undefined, duration = DUR * 0.65): Promise<void> {
  const from = node?.getBoundingClientRect();
  if (!node || !from?.width) return Promise.resolve();
  const end = to?.width ? { transformOrigin: "0 0", transform: between(to, from) } : { transformOrigin: "50% 50%", transform: "scale(0.6)", opacity: 0 };
  const a = still()
    ? vanish(node)
    : node.animate([{ transformOrigin: end.transformOrigin, transform: "none", opacity: 1 }, end], { duration, easing: EASE, fill: "forwards" });
  const done = () => undefined;
  return a.finished.then(done, done); // cancelled by a reopen (settle): done too, not an error
}

// Fade an element in or out (the backdrop behind a large photo). Opacity only, so it runs under reduced motion too.
export const fade = (node: Element | null | undefined, show: boolean, duration = DUR * 0.6) =>
  node?.animate(show ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], {
    duration: still() ? QUIET : duration,
    easing: "ease-out",
    fill: "forwards",
  });

// Step to the next photo: it slides in from that side.
export function slideIn(node: Element | null, dir: number) {
  if (!node) return;
  settle(node);
  if (still()) return appear(node);
  node.animate(
    [
      { opacity: 0, transform: `translateX(${dir * 48}px)` },
      { opacity: 1, transform: "none" },
    ],
    { duration: DUR * 0.8, easing: EASE },
  );
}

// A panel that follows a photo in: it comes in from the side it sits on (`from`, e.g. "16px 0" when it is to the
// right, "0 16px" when below), a beat after the photo starts moving.
export function follow(node: Element | null | undefined, from: string) {
  if (!node) return;
  if (still()) return appear(node);
  node.animate(
    [
      { opacity: 0, translate: from },
      { opacity: 1, translate: "0 0" },
    ],
    { duration: DUR * 0.7, delay: 90, easing: EASE, fill: "backwards" },
  );
}

// A photo's size on screen: as large as fits, keeping its aspect.
export function fit(aspect: number, maxW: number, maxH: number) {
  const width = Math.min(maxW, maxH * aspect);
  return { width, height: width / aspect };
}

// Apple's ease-out curve; a plain cut when the system asks for reduced motion.
export const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const DUR = 420;
export const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export type Box = { left: number; top: number; width: number; height: number };

const between = (a: Box, b: Box) => `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;

// FLIP: draw node where `from` was, then let it glide to where the layout put it.
export function flip(node: Element | null, from: Box | undefined) {
  const to = node?.getBoundingClientRect();
  if (!node || !to?.width || !from?.width) return;
  node.animate(
    [
      { transformOrigin: "0 0", transform: between(from, to) },
      { transformOrigin: "0 0", transform: "none" },
    ],
    { duration: still() ? 0 : DUR, easing: EASE },
  );
}

// The way back: node flies from where it is onto `to` (its thumbnail), or shrinks away without one. Resolves when done.
export function flyBack(node: Element | null, to: Box | undefined, duration = DUR * 0.65): Promise<void> {
  const from = node?.getBoundingClientRect();
  if (!node || !from?.width || still()) return Promise.resolve();
  const end = to?.width ? { transformOrigin: "0 0", transform: between(to, from) } : { transformOrigin: "50% 50%", transform: "scale(0.6)", opacity: 0 };
  const a = node.animate([{ transformOrigin: end.transformOrigin, transform: "none", opacity: 1 }, end], { duration, easing: EASE, fill: "forwards" });
  return a.finished.then(() => undefined);
}

// Fade an element in or out (the backdrop behind a large photo).
export const fade = (node: Element | null | undefined, show: boolean, duration = DUR * 0.6) =>
  node?.animate(show ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], {
    duration: still() ? 0 : duration,
    easing: "ease-out",
    fill: "forwards",
  });

// Step to the next photo: it slides in from that side.
export const slideIn = (node: Element | null, dir: number) =>
  node?.animate(
    [
      { opacity: 0, transform: `translateX(${dir * 48}px)` },
      { opacity: 1, transform: "none" },
    ],
    { duration: still() ? 0 : DUR * 0.8, easing: EASE },
  );

// A photo's size on screen: as large as fits, keeping its aspect.
export function fit(aspect: number, maxW: number, maxH: number) {
  const width = Math.min(maxW, maxH * aspect);
  return { width, height: width / aspect };
}

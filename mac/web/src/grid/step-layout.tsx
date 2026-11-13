import { useLayoutEffect, useRef } from "react";
import { PageHeader } from "@/components/page-header";
import type { StepProps } from "@/grid/app";

// A review step: the sticky header with its Apply bar, a line on what the step does, then the step. The step's
// content rises in when it first renders (Junk and Events pass nothing until their data is in).
export function StepLayout({ step, onStep, apply, hint, children }: StepProps & { apply: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  // Focused controls never land under the header: the page keeps that much room at the top, as tall as it wraps.
  useLayoutEffect(() => {
    const root = document.documentElement,
      el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => root.style.setProperty("scroll-padding-block-start", `${el.offsetHeight + 8}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("scroll-padding-block-start");
    };
  }, []);
  return (
    <>
      <div ref={bar} className="sift-bar-sticky sticky top-0 z-10 -mx-4 mb-3">
        <div className="sift-bar px-4 py-2.5">
          <PageHeader step={step} onStep={onStep}>
            {apply}
          </PageHeader>
        </div>
      </div>
      <p className="mb-3 text-xs text-pretty text-muted-foreground">
        Nothing is written to Photos until <b className="font-semibold text-foreground">Apply to Photos</b>.{hint && <> {hint}</>}
      </p>
      {children != null && <div className="sift-enter">{children}</div>}
    </>
  );
}

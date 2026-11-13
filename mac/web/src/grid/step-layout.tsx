import { PageHeader } from "@/components/page-header";
import type { StepProps } from "@/grid/app";

// A review step: the sticky header with its Apply bar, a line on what the step does, then the step.
export function StepLayout({ step, onStep, apply, hint, children }: StepProps & { apply: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <div className="sticky top-0 z-10 -mx-4 mb-3 border-b bg-background/95 px-4 py-2.5 backdrop-blur">
        <PageHeader step={step} onStep={onStep}>
          {apply}
        </PageHeader>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Nothing is written to Photos until <b>Apply to Photos</b>.{hint && <> {hint}</>}
      </p>
      {children}
    </>
  );
}

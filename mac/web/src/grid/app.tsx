import { useEffect, useState } from "react";
import { STEPS, type Step } from "@/components/view-nav";
import { Dupes } from "@/grid/dupes";
import { Events } from "@/grid/events";
import { Junk } from "@/grid/junk";

// The Grid page: one review step at a time, chosen in the header and kept in the address (#duplicates, #events, #best-of).
const fromHash = (): Step => (location.hash === "#locations" ? "events" : (STEPS.find((s) => s.hash && s.hash === location.hash)?.id ?? "junk"));

export function App() {
  const [step, setStep] = useState<Step>(fromHash);
  useEffect(() => {
    const on = () => setStep(fromHash());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  const go = (s: Step) => {
    history.replaceState(null, "", location.pathname + (STEPS.find((x) => x.id === s)?.hash ?? "")); // a new step starts without the last one's filter and page
    setStep(s);
  };
  const View = { junk: Junk, dupes: Dupes, events: Events, best: Events }[step];
  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-12">
      <View key={step} step={step} onStep={go} />
      <footer className="mt-8 text-xs text-muted-foreground">
        Place names:{" "}
        <a className="underline underline-offset-2 hover:text-foreground" href="https://www.geonames.org/">
          GeoNames
        </a>
        , CC BY 4.0.
      </footer>
    </main>
  );
}

export type StepProps = { step: Step; onStep: (s: Step) => void };

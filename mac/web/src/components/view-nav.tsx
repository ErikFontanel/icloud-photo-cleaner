import { MoonIcon, SunIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toggleTheme, useTheme } from "@/lib/theme";

// One switcher for both pages: the Grid's review steps and the table's layouts. Items on the other page are links.
export const STEPS = [
  { id: "junk", label: "Junk", hash: "" },
  { id: "dupes", label: "Duplicates", hash: "#duplicates" },
  { id: "events", label: "Events", hash: "#events" },
  { id: "best", label: "Best-of", hash: "#best-of" },
] as const;
export type Step = (typeof STEPS)[number]["id"];
export const LAYOUTS = [
  { id: "pile", label: "Pile", key: "2" },
  { id: "events", label: "Events", key: "3" },
  { id: "look", label: "Visual", key: "4" },
  { id: "time", label: "Time", key: "5" },
] as const;
export type Layout = (typeof LAYOUTS)[number]["id"];

// The step or layout you are on, like a segmented control's selected segment.
const ACTIVE = "aria-pressed:bg-secondary aria-pressed:font-semibold aria-pressed:ring-1 aria-pressed:ring-foreground/25 aria-pressed:ring-inset";

type Props = { step?: Step; onStep?: (s: Step) => void; layout?: Layout; onLayout?: (l: Layout) => void };

export function ViewNav({ step, onStep, layout, onLayout }: Props) {
  const onTable = !!onLayout;
  return (
    <nav aria-label="View" className="flex flex-none flex-nowrap items-center gap-2">
      <ButtonGroup aria-label="Grid steps">
        <ButtonGroupText className="bg-card text-muted-foreground">Grid{onTable && <Kbd>1</Kbd>}</ButtonGroupText>
        {STEPS.map((s) =>
          onStep ? (
            <Button key={s.id} variant="outline" size="sm" aria-pressed={step === s.id} className={ACTIVE} onClick={() => onStep(s.id)}>
              {s.label}
            </Button>
          ) : (
            <Button key={s.id} variant="outline" size="sm" asChild>
              <a href={`/${s.hash}`}>{s.label}</a>
            </Button>
          ),
        )}
      </ButtonGroup>
      <ButtonGroup aria-label="Table layouts">
        <ButtonGroupText className="bg-card text-muted-foreground">Table</ButtonGroupText>
        {LAYOUTS.map((l) =>
          onLayout ? (
            <Button key={l.id} data-layout={l.id} variant="outline" size="sm" aria-pressed={layout === l.id} className={ACTIVE} onClick={() => onLayout(l.id)}>
              {l.label}
              <Kbd>{l.key}</Kbd>
            </Button>
          ) : (
            <Button key={l.id} variant="outline" size="sm" asChild>
              <a href={`/table#${l.id}`}>{l.label}</a>
            </Button>
          ),
        )}
      </ButtonGroup>
    </nav>
  );
}

export function ThemeButton() {
  const dark = useTheme() === "dark",
    label = dark ? "Light ground" : "Dark ground",
    [switched, setSwitched] = useState(false), // the icon animates on a switch, not on page load
    swap = switched ? "sift-icon-in" : undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={label} onClick={() => (setSwitched(true), toggleTheme())}>
          {dark ? <SunIcon key="sun" className={swap} /> : <MoonIcon key="moon" className={swap} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

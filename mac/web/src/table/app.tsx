import { EraserIcon, EyeOffIcon, KeyboardIcon, ScanIcon, Undo2Icon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApplyBar } from "@/components/apply-bar";
import { ConfirmButton } from "@/components/confirm-button";
import { EventTitle } from "@/components/event-title";
import { EventName, PhotoMeta } from "@/components/meta/photo-meta";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Spot } from "@/lib/api";
import { pendingParts } from "@/lib/format";
import { DUR, fade, fit, flip, flyBack, slideIn } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { type Engine, startTable } from "@/table/engine";
import { createHud, type Hud, type HudState, type Selection, useHud } from "@/table/hud";

const hud = createHud();

// The photo table: the canvas (engine.js) with the shared header, the inspector for the selection, the To Delete
// tray, the key help and quick look around it.
export function TableApp() {
  const h = useHud(hud),
    [engine, setEngine] = useState<Engine | null>(null),
    started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; the canvas starts once
    started.current = true;
    setEngine(startTable(hud));
  }, []);
  const parts = pendingParts(h.pending);
  // Tools: a Toggle when it switches a mode on and off, a Button when it acts once. The label is in the tooltip.
  const tool = (label: string, key: string, onClick: () => void, icon: React.ReactNode, pressed?: boolean, id?: string) => {
    const inner = (
      <>
        {icon}
        <Kbd>{key}</Kbd>
      </>
    );
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {pressed === undefined ? (
            <Button id={id} variant="outline" size="sm" aria-label={label} onClick={onClick} disabled={!engine}>
              {inner}
            </Button>
          ) : (
            <Toggle
              id={id}
              variant="outline"
              size="sm"
              aria-label={label}
              pressed={pressed}
              onPressedChange={onClick}
              disabled={!engine}
              className={cn("rounded-none first:rounded-l-md", id === "eraser" && "data-[state=on]:bg-destructive data-[state=on]:text-white")}
            >
              {inner}
            </Toggle>
          )}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  };
  return (
    <>
      <canvas
        id="gl"
        className={cn(
          "fixed inset-0 block size-full touch-none cursor-crosshair",
          "[&.over]:cursor-grab [&.dragging]:cursor-grabbing [&.panning]:cursor-grabbing [&.erasing]:cursor-cell",
        )}
      />
      <canvas id="lasso" className="pointer-events-none fixed inset-0 block size-full" />
      <div
        id="labels"
        className="pointer-events-none fixed inset-0 overflow-hidden [&_div]:absolute [&_div]:origin-bottom-left [&_div]:text-xs [&_div]:font-semibold [&_div]:whitespace-nowrap [&_div]:text-muted-foreground [&_.ev]:text-[13px] [&_.ev]:text-event [&_.ev]:italic [&_.ev]:opacity-85 [&_.ev.album]:not-italic [&_.ev.album]:opacity-100 [&_.ev.album]:before:content-['▣_'] [&_.year]:text-[28px] [&_.year]:text-foreground"
      />
      <header className="pointer-events-none fixed inset-x-3 top-3 [&>*]:pointer-events-auto">
        <PageHeader
          layout={h.layout}
          onLayout={(l) => engine?.layout(l)}
          tools={
            <ButtonGroup aria-label="Table tools">
              {tool("Eraser", "E", () => engine?.eraser(), <EraserIcon />, h.erasing, "eraser")}
              {tool("Hide in albums", "H", () => engine?.hideAlbums(), <EyeOffIcon />, h.hideAlbums, "hidealbums")}
              {tool("Fit", "F", () => engine?.fit(), <ScanIcon />)}
              {tool("Undo", "⌘Z", () => engine?.undo(), <Undo2Icon />)}
              {tool("Keys", "?", () => hud.set({ help: !h.help }), <KeyboardIcon />, h.help)}
            </ButtonGroup>
          }
        >
          <ApplyBar
            summary={parts.length ? parts.join(" · ") : "Nothing to apply yet."}
            question={`Write ${parts.join(", ")} to the library Photos has open?`}
            canApply={parts.length > 0}
            onApply={async () => {
              if (engine) toast.success(await engine.apply());
            }}
          >
            {h.lastApply && engine && (
              <ConfirmButton
                variant="outline"
                size="sm"
                title="Undo the last apply?"
                description="Takes the photos of the last apply out of the albums in Photos again, then reloads the table."
                confirm="Undo apply"
                action={engine.undoApply}
              >
                Undo last apply
              </ConfirmButton>
            )}
          </ApplyBar>
        </PageHeader>
      </header>
      {engine && h.selection && h.st && <Inspector engine={engine} hud={hud} sel={h.selection} />}
      <button
        id="tray"
        type="button"
        data-press
        onClick={() => engine?.restoreTray()}
        title="Click to put its photos back on the table"
        className="fixed bottom-3.5 left-1/2 min-w-40 -translate-x-1/2 cursor-pointer rounded-xl border-[1.5px] border-dashed bg-card px-3.5 py-2.5 text-left transition-[border-color,translate] [&.hot]:-translate-y-1 [&.hot]:border-destructive"
      >
        <b className="block text-lg text-destructive tabular-nums">{h.deleteCount.toLocaleString()}</b>
        <span className="text-xs text-muted-foreground">To Delete · drop, ⌫ or eraser</span>
      </button>
      <div className="fixed bottom-3.5 left-3 grid max-w-80 justify-items-start gap-2">
        {h.help && <KeyHelp />}
        <span id="status" role="status" className="rounded-md border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          {h.status}
        </span>
      </div>
      <div id="fps" className="fixed right-3 bottom-2.5 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground" />
      <QuickLook ql={h.ql} onClose={() => engine?.closeQL()} />
      {h.loading && (
        <div id="loading" className="fixed inset-0 grid place-items-center text-muted-foreground">
          {h.loading}
        </div>
      )}
    </>
  );
}

// The selection: its event's name, then the same place, tags and albums fields as the Grid.
function Inspector({ engine, hud, sel }: { engine: Engine; hud: Hud; sel: Selection }) {
  const st = useHud(hud).st;
  const [spots, setSpots] = useState<Spot[] | null>(null),
    [asked, setAsked] = useState(0); // a place edit asks again
  const key = sel.uuids.join();
  // Place of the selected photos without GPS, grouped by city (set or suggested); asked once the selection settles.
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for sel.uuids
  useEffect(() => {
    let on = true;
    setSpots(null);
    const t = setTimeout(async () => {
      try {
        const r = await engine.api<{ spots: Spot[] }>("/api/table/place-info", { uuids: sel.uuids, pile_uuids: sel.pileUuids, name: sel.name || sel.label });
        if (on) setSpots(r.spots);
      } catch (e) {
        engine.say((e as Error).message);
      }
    }, 150);
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [key, asked, engine]);
  if (!st) return null;
  const edit = async (path: string, body: object) => {
    const r = await engine.api<{ tags?: unknown; pending?: object }>(path, body);
    if (r.tags) engine.takeState(r as never);
    else engine.pending(r.pending);
    if (path === "/api/table/place") setAsked((n) => n + 1);
    return r;
  };
  return (
    <Card
      className="sift-pop fixed top-16 right-3 max-h-[calc(100vh-160px)] w-80 gap-0 overflow-auto overscroll-contain py-3 shadow-lg [--from:8px_0]"
      role="region"
      aria-label="Selection"
    >
      <CardContent className="grid gap-4 px-3">
        <div className="grid gap-1">
          <EventTitle name={sel.name} label={sel.label} />
          <div className="text-xs text-muted-foreground">
            {sel.events > 1 ? (
              `${sel.events} events selected · M merges them`
            ) : (
              <button
                type="button"
                className="underline-offset-2 hover:text-foreground hover:underline"
                onClick={(e) => {
                  e.currentTarget.blur(); // Space closes the large photo; it must not press this again
                  engine.viewEvent();
                }}
              >
                {sel.pileUuids.length} photos in this event
              </button>
            )}
          </div>
        </div>
        <EventName id="evname" name={sel.name} label={sel.label} onSave={engine.setName} blurOnSubmit />
        <PhotoMeta
          uuids={sel.uuids}
          st={st}
          eventName={sel.name}
          withEventAlbum
          spots={spots}
          edit={edit}
          ids={{ place: "placein", tag: "tagin", album: "albumin" }}
          blurOnSubmit
        />
      </CardContent>
    </Card>
  );
}

function KeyHelp() {
  const rows: [string, string][] = [
    ["Drag", "on the table: lasso · ⇧ adds · ⌥ removes"],
    ["Drag", "a photo: move it with the selection"],
    ["Two fingers", "pan · pinch: zoom · Space-drag: pan"],
    ["M N R", "merge selected piles into one event · new event · rename"],
    ["G S", "gather selection · pull in similar photos"],
    ["T A L", "add a tag · add to an album · set a place"],
    ["E H", "eraser · hide photos in albums"],
    ["⌫ Space", "To Delete · quick look (←/→)"],
    ["⌘A Esc Z", "select all · clear · zoom to selection"],
  ];
  return (
    <Card id="help" className="sift-pop gap-2 py-3 text-xs text-muted-foreground shadow-lg max-md:hidden">
      <CardContent className="grid gap-1.5 px-3">
        {rows.map(([k, t]) => (
          <div key={k + t}>
            {k.split(" ").map((x) => (
              <Kbd key={x} className="mr-1">
                {x}
              </Kbd>
            ))}
            {t}
          </div>
        ))}
        <p>Click the tray to put its photos back on the table.</p>
        <p className="italic">Everything is saved at once and shared with the Grid. Nothing reaches Photos until Apply.</p>
      </CardContent>
    </Card>
  );
}

// Quick look: one photo over the table. It grows out of its place on the table, slides on ←/→, and shrinks back on close.
function QuickLook({ ql, onClose }: { ql: HudState["ql"]; onClose: () => void }) {
  const big = useRef<HTMLImageElement>(null),
    layer = useRef<HTMLButtonElement>(null),
    at = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!ql) {
      at.current = null;
      return;
    }
    if (ql.closing) {
      fade(layer.current, false, DUR * 0.65);
      flyBack(big.current, ql.to ?? undefined).then(() => hud.get().ql?.closing && hud.set({ ql: null }));
    } else if (ql.from) {
      fade(layer.current, true);
      flip(big.current, ql.from);
    } else if (at.current !== null && at.current !== ql.at) slideIn(big.current, ql.at > at.current ? 1 : -1);
    at.current = ql.at;
  }, [ql]);
  const size = ql && fit(ql.aspect, innerWidth * 0.92, innerHeight * 0.84);
  return (
    <button
      ref={layer}
      id="ql"
      type="button"
      aria-label="Close quick look"
      hidden={!ql}
      className="fixed inset-0 grid cursor-zoom-out place-items-center bg-background"
      onClick={onClose}
    >
      {ql && size && (
        <>
          <img ref={big} src={ql.src} alt="" style={size} className="sift-photo max-w-none bg-tile object-contain shadow-2xl" />
          <span className="fixed inset-x-0 bottom-4.5 text-center text-muted-foreground">{ql.caption}</span>
        </>
      )}
    </button>
  );
}

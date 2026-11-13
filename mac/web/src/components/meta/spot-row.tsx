import { MapPinIcon, PencilIcon, XIcon } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { SubmitField } from "@/components/meta/submit-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Spot } from "@/lib/api";
import { placeText, plural, where } from "@/lib/format";
import { cn } from "@/lib/utils";

export type SetPlace = (uuids: string[], city: string, country?: string) => Promise<unknown>;

// One place of photos without GPS: set (green), suggested (Use takes it) or unknown. Change opens a field for just these photos.
export function SpotRow({ spot: g, onSet, className }: { spot: Spot; onSet: SetPlace; className?: string }) {
  const state = g.set ? "Set" : g.city ? "Suggested" : null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-sm", className)}>
      <MapPinIcon className={cn("size-4 shrink-0", g.set ? "text-keep" : "text-muted-foreground")} />
      <span className={cn(g.set ? "text-keep" : !g.city && "text-muted-foreground")}>{where(g)}</span>
      {state && (
        <Badge variant="outline" title={g.set ? undefined : `Suggested from ${g.from}`}>
          {state}
        </Badge>
      )}
      <span className="text-xs text-muted-foreground">{plural(g.uuids.length, "photo")}</span>
      <span className="flex items-center">
        {g.city && !g.set && (
          <ActionButton variant="link" size="xs" title={`Suggested from ${g.from}`} action={() => onSet(g.uuids, g.city as string, g.country)}>
            Use
          </ActionButton>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Change place" title="Change place">
              <PencilIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            <SubmitField
              label="City or coordinates"
              placeholder="City (Kyoto, JP), coordinates or map link"
              initial={placeText(g)}
              autoFocus
              onSubmit={(v) => onSet(g.uuids, v)}
            />
          </PopoverContent>
        </Popover>
        {g.set && (
          <ActionButton variant="ghost" size="icon-xs" aria-label="Clear place" title="Clear place" action={() => onSet(g.uuids, "")}>
            <XIcon />
          </ActionButton>
        )}
      </span>
    </div>
  );
}

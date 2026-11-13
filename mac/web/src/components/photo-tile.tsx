import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// A photo in the Junk and Duplicates grids: its own width at a fixed height (nothing cropped), framed red when it
// goes and green when it stays; a click toggles it.
export function PhotoTile({
  uuid,
  kept,
  dim,
  badge,
  title,
  onToggle,
}: {
  uuid: string;
  kept: boolean;
  dim?: boolean;
  badge: string;
  title?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={kept}
      title={title}
      onClick={onToggle}
      className={cn(
        "relative h-80 min-w-30 max-w-full cursor-pointer overflow-hidden rounded-md border-3 bg-tile p-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        kept ? "border-keep" : "border-destructive",
      )}
    >
      <img src={`/preview/${uuid}`} loading="lazy" alt="" className={cn("mx-auto block h-full w-auto max-w-full object-contain", dim && "opacity-40")} />
      <Badge className={cn("absolute bottom-1.5 left-1.5 text-background", kept ? "bg-keep" : "bg-destructive")}>{badge}</Badge>
    </button>
  );
}

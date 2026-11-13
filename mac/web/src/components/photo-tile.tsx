import { CheckIcon, XIcon } from "lucide-react";
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
  albums,
  onToggle,
}: {
  uuid: string;
  kept: boolean;
  dim?: boolean;
  badge: string;
  title?: string;
  albums?: string[];
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-press
      aria-pressed={kept}
      title={title}
      onClick={onToggle}
      className={cn(
        "relative h-80 min-w-30 max-w-full cursor-pointer overflow-hidden rounded-lg border-3 bg-tile p-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        kept ? "border-keep" : "border-destructive",
      )}
    >
      <img
        src={`/preview/${uuid}`}
        loading="lazy"
        alt=""
        className={cn("mx-auto block h-full w-auto max-w-full object-contain transition-opacity duration-150 ease-out", dim && "opacity-40")}
      />
      {albums && albums.length > 0 && (
        <div className="absolute inset-x-2 top-2 flex flex-wrap gap-1">
          {albums.map((a) => (
            <Badge key={a} variant="secondary" className="max-w-full truncate shadow-sm">
              {a}
            </Badge>
          ))}
        </div>
      )}
      <Badge className={cn("absolute bottom-2 left-2 text-background shadow-sm transition-colors duration-150", kept ? "bg-keep" : "bg-destructive")}>
        {kept ? <CheckIcon /> : <XIcon />}
        {badge}
      </Badge>
    </button>
  );
}

import { Undo2Icon, XIcon } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { AddField } from "@/components/meta/add-field";
import { Badge } from "@/components/ui/badge";
import { ALBUM_TIP, type Album } from "@/lib/albums";
import { cn } from "@/lib/utils";

type Props = {
  albums: Album[];
  of: number;
  index: string[];
  onEdit: (album: string, remove: boolean) => Promise<unknown>;
  inputId?: string;
  blurOnSubmit?: boolean;
};

// Albums of the photos. Your own Photos albums can't be left from here (Photos would rebuild them, losing folder and
// order); event albums and additions can, and taken-out photos can be put back until Apply.
export function AlbumsField({ albums, of, index, onEdit, inputId, blurOnSubmit }: Props) {
  return (
    <div className="grid gap-2">
      {albums.length ? (
        <div className="flex flex-wrap gap-1">
          {albums.map((a) => (
            <Badge
              key={a.title}
              variant={a.kind === "own" ? "outline" : "secondary"}
              title={ALBUM_TIP[a.kind]}
              className={cn(
                "pr-0.5",
                a.kind === "add" && "border-dashed border-primary",
                !a.n && "text-muted-foreground line-through",
                a.kind === "own" && "pr-2",
              )}
            >
              {a.kind === "add" && "+ "}
              {a.title}
              {a.n !== of && (
                <span className="text-muted-foreground">
                  · {a.n} of {of}
                </span>
              )}
              {a.kind !== "own" && a.n > 0 && (
                <ActionButton
                  variant="ghost"
                  size="icon-xs"
                  className="size-4 rounded-full"
                  aria-label={`Take out of ${a.title}`}
                  title="Take out of this album"
                  action={() => onEdit(a.title, true)}
                >
                  <XIcon />
                </ActionButton>
              )}
              {a.kind !== "own" && a.out > 0 && (
                <ActionButton
                  variant="ghost"
                  size="icon-xs"
                  className="size-4 rounded-full"
                  aria-label={`Put back in ${a.title}`}
                  title="Put back"
                  action={() => onEdit(a.title, false)}
                >
                  <Undo2Icon />
                </ActionButton>
              )}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">In no album</p>
      )}
      <AddField
        id={inputId}
        label="Add to an album"
        placeholder={of > 1 ? `Add the ${of} to an album` : "Add to an album"}
        index={index}
        onAdd={(a) => onEdit(a, false)}
        blurOnSubmit={blurOnSubmit}
      />
    </div>
  );
}

import { XIcon } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { AddField } from "@/components/meta/add-field";
import { Badge } from "@/components/ui/badge";

type Props = {
  tags: [string, number][]; // word and how many of the photos have it
  of: number;
  index: string[];
  onEdit: (add: string[], remove: string[]) => Promise<unknown>;
  inputId?: string;
  blurOnSubmit?: boolean;
};

// Tags of the photos (a count when only some have one) and a field to add one to all of them.
export function TagsField({ tags, of, index, onEdit, inputId, blurOnSubmit }: Props) {
  return (
    <div className="grid gap-2">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map(([w, n]) => (
            <Badge key={w} variant="secondary" className="pr-0.5">
              {w}
              {n !== of && (
                <span className="text-muted-foreground">
                  · {n} of {of}
                </span>
              )}
              <ActionButton variant="ghost" size="icon-xs" className="size-4 rounded-full" aria-label={`Remove tag ${w}`} action={() => onEdit([], [w])}>
                <XIcon />
              </ActionButton>
            </Badge>
          ))}
        </div>
      )}
      <AddField
        id={inputId}
        label="Add a tag"
        placeholder={of > 1 ? `Add a tag to the ${of}` : "Add a tag"}
        index={index}
        onAdd={(w) => onEdit([w], [])}
        blurOnSubmit={blurOnSubmit}
      />
    </div>
  );
}

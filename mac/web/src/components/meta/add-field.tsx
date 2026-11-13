import { PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";

type Props = { id?: string; label: string; placeholder: string; index: string[]; onAdd: (value: string) => Promise<unknown>; blurOnSubmit?: boolean };

// Add a tag or an album: type a new one or pick one you used before. Enter adds the highlighted line.
export function AddField({ id, label, placeholder, index, onAdd, blurOnSubmit }: Props) {
  const [q, setQ] = useState(""),
    [open, setOpen] = useState(false),
    [active, setActive] = useState<string | undefined>(), // the highlighted line; the first one until arrows move it
    ref = useRef<HTMLInputElement>(null);
  const t = q.trim(),
    low = t.toLowerCase();
  const matches = t ? index.filter((w) => w.toLowerCase().includes(low)).slice(0, 8) : [];
  const first = index.includes(t) ? matches[0] : `+${t}`;
  const add = async (v: string) => {
    try {
      await onAdd(v);
      setQ("");
      if (blurOnSubmit) ref.current?.blur();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Command shouldFilter={false} value={active ?? first} onValueChange={setActive} className="h-auto overflow-visible bg-transparent">
      {/* A plain input, not cmdk's: cmdk moves focus to its own input id. Arrows and Enter still reach the list. */}
      <Input
        ref={ref}
        id={id}
        aria-label={label}
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(undefined);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          setQ("");
          e.currentTarget.blur();
        }}
      />
      {open && t && (
        <CommandList className="mt-1 rounded-md border bg-popover shadow-md">
          <CommandGroup>
            {!index.includes(t) && (
              <CommandItem value={`+${t}`} onMouseDown={(e) => e.preventDefault()} onSelect={() => add(t)}>
                <PlusIcon />
                Add “{t}”
              </CommandItem>
            )}
            {matches.map((w) => (
              <CommandItem key={w} value={w} onMouseDown={(e) => e.preventDefault()} onSelect={() => add(w)}>
                {w}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      )}
    </Command>
  );
}

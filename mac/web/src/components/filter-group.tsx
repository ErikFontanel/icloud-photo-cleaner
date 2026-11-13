import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// Pick one of several filters, each with its count ("Blurry · 12"). One is always picked.
export function FilterGroup<T extends string>({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; count?: number }[];
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={1}
      aria-label={label}
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      className="flex-wrap"
    >
      {items.map((i) => (
        <ToggleGroupItem key={i.value} value={i.value} className="rounded-full px-3">
          {i.label}
          {i.count !== undefined && <span className="text-muted-foreground">· {i.count.toLocaleString()}</span>}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

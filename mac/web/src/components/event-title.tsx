import { cn } from "@/lib/utils";

// An event's title everywhere: your name (it becomes an album), a suggestion, or nothing yet.
export function EventTitle({ name, label, className }: { name?: string; label?: string; className?: string }) {
  return (
    <div className={cn("font-semibold text-event", !name && "italic", !name && !label && "font-medium text-muted-foreground", className)}>
      {name ? `▣ ${name}` : label ? `Suggested: ${label}` : "Unnamed event"}
    </div>
  );
}

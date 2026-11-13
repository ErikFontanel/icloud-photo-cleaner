import { cn } from "@/lib/utils";

// A row of small photos at their own width.
export function Strip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("my-2 flex flex-wrap items-center gap-1", className)}>{children}</div>;
}
export const Thumb = ({ u, className }: { u: string; className?: string }) => (
  <img src={`/thumb/${u}?s=320`} loading="lazy" alt="" className={cn("block h-30 w-auto rounded bg-tile", className)} />
);

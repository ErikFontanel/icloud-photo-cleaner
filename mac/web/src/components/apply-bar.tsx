import { useEffect, useState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";

type Props = {
  summary: string; // what is saved but not in Photos yet, or that there is nothing
  question: string; // the confirmation: what will be written where
  canApply: boolean;
  onApply: () => Promise<void>;
  children?: React.ReactNode; // more buttons before Apply (Undo)
};

// Apply to Photos, the same on every step and the table: a summary, a confirmation dialog, then progress while it writes.
export function ApplyBar({ summary, question, canApply, onApply, children }: Props) {
  const [writing, setWriting] = useState(false);
  if (writing) return <ApplyProgress />;
  return (
    <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
      <span className="min-w-0 truncate text-xs text-muted-foreground" title={summary}>
        {summary}
      </span>
      {children}
      <ConfirmButton
        size="sm"
        disabled={!canApply}
        title="Apply to Photos?"
        description={question}
        confirm="Write to Photos"
        action={async () => {
          setWriting(true);
          try {
            await onApply();
          } finally {
            setWriting(false);
          }
        }}
      >
        Apply to Photos
      </ConfirmButton>
    </div>
  );
}

type Status = { step?: string; done?: number; total?: number };
// While Apply writes to Photos: what it is writing and how far it is, polled each second.
function ApplyProgress() {
  const [p, setP] = useState<Status>({});
  useEffect(() => {
    let on = true;
    (async () => {
      while (on) {
        try {
          const next = await api<Status>("/api/table/apply/progress");
          if (on) setP(next);
        } catch {
          /* the next poll tries again */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();
    return () => {
      on = false;
    };
  }, []);
  return (
    <div className="sift-pop flex min-w-0 flex-1 items-center justify-end gap-3 [--from:0_0]" role="status">
      <span className="truncate text-xs text-muted-foreground">
        {p.total ? `${p.step} · ${p.done?.toLocaleString()} of ${p.total.toLocaleString()} photos` : `${p.step || "Writing to Photos"}…`}
      </span>
      <Progress key={p.step} className="w-56" value={p.total ? ((p.done || 0) / p.total) * 100 : 0} />
    </div>
  );
}

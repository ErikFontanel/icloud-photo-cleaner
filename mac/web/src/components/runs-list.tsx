import { ConfirmButton } from "@/components/confirm-button";
import { Separator } from "@/components/ui/separator";
import type { Run } from "@/lib/api";
import { minute } from "@/lib/format";

// Earlier applies of a step; each one not undone yet can be undone (its photos come out of the album again).
export function RunsList({ runs, album, onUndo }: { runs: Run[]; album: string; onUndo: (run: number) => Promise<void> }) {
  return (
    <section className="mt-8 text-xs text-muted-foreground">
      <h2 className="mb-2 font-semibold text-foreground">Applied runs</h2>
      <Separator className="mb-2" />
      {!runs.length && <p>None yet.</p>}
      <ul className="grid gap-1">
        {runs.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            Run {r.id} · {r.step} · {r.writes} added to album · {minute(r.created)} UTC
            {r.undone ? (
              <span>· undone {minute(r.undone)}</span>
            ) : (
              <ConfirmButton
                variant="ghost"
                size="xs"
                title={`Undo run ${r.id}?`}
                description={`Remove the ${r.writes} photos of run ${r.id} from “${album}”.`}
                confirm="Undo run"
                action={() => onUndo(r.id)}
              >
                Undo
              </ConfirmButton>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

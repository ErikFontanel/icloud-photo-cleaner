import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";

type Scan = { running?: boolean; result?: string; error?: string };
// For an empty step: rescan the library for photos added or changed since the last scan, then done(summary).
export function RescanButton({ done }: { done: (summary: string) => void }) {
  const [busy, setBusy] = useState(false),
    [text, setText] = useState("");
  const poll = async (): Promise<void> => {
    let s: Scan;
    try {
      s = await api<Scan>("/api/scan");
    } catch (e) {
      s = { error: (e as Error).message };
    }
    if (s.running) {
      setText("Scanning… new photos are analysed on this Mac; this can take a few minutes.");
      setTimeout(poll, 2000);
      return;
    }
    setBusy(false);
    const t = s.error ? `Scan failed: ${s.error}` : `Scanned: ${s.result}.`;
    setText(t);
    if (!s.error) done(t);
  };
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/api/scan", {}); // refused while an apply or undo runs
            poll();
          } catch (e) {
            setBusy(false);
            setText((e as Error).message);
          }
        }}
      >
        Rescan for new photos
        {busy && <Spinner />}
      </Button>
      <span className="text-xs text-muted-foreground">{text}</span>
    </span>
  );
}

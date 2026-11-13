import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// A Button whose click runs an async action: it spins and is disabled until the action ends; a failure is a toast.
export function ActionButton({
  action,
  disabled,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick"> & { action: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      {...props}
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await action();
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {busy && <Spinner />}
    </Button>
  );
}

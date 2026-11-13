import { CheckIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

type Props = {
  id?: string;
  label: string;
  placeholder: string;
  initial?: string; // the saved text
  suggest?: string; // filled in when nothing is saved yet: Enter takes it
  onSubmit: (value: string) => Promise<unknown>;
  blurOnSubmit?: boolean; // the table: keys go back to the canvas
  autoFocus?: boolean;
  disabled?: boolean;
};

// One line of text saved with Enter or the check button (Esc puts the saved text back). Used for event names and places.
export function SubmitField({ id, label, placeholder, initial = "", suggest = "", onSubmit, blurOnSubmit, autoFocus, disabled }: Props) {
  const shown = initial || suggest;
  const [value, setValue] = useState(shown),
    [busy, setBusy] = useState(false),
    ref = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(shown), [shown]);
  const changed = value.trim() !== "" && value.trim() !== initial;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!changed || busy) return;
        setBusy(true);
        try {
          await onSubmit(value.trim());
          if (blurOnSubmit) ref.current?.blur();
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <InputGroup>
        <InputGroupInput
          ref={ref}
          id={id}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            setValue(shown);
            e.currentTarget.blur();
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="submit" size="icon-xs" aria-label="Save" title="Save (Enter)" disabled={disabled || !changed || busy}>
            {busy ? <Spinner /> : <CheckIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

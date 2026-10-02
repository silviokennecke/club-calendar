import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ToggleProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Controlled state. */
  checked?: boolean;
  /** Initial state when uncontrolled. */
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** On/off switch (button role="switch") with a visible label and optional hint. */
export function Toggle({
  label,
  hint,
  checked,
  defaultChecked = false,
  onChange,
  disabled,
  id,
  className,
}: ToggleProps) {
  const autoId = useId().replace(/:/g, "");
  const baseId = id ?? `toggle-${autoId}`;
  const labelId = `${baseId}-label`;
  const hintId = hint ? `${baseId}-hint` : undefined;
  const [internal, setInternal] = useState(defaultChecked);
  const on = checked ?? internal;

  function toggle() {
    if (checked === undefined) setInternal(!on);
    onChange?.(!on);
  }

  return (
    <div className={cn("cc-toggle-row", className)}>
      <div>
        <div className="cc-label" id={labelId}>
          {label}
        </div>
        {hint && (
          <div className="cc-hint" id={hintId}>
            {hint}
          </div>
        )}
      </div>
      <button
        type="button"
        id={baseId}
        role="switch"
        aria-checked={on}
        aria-labelledby={labelId}
        aria-describedby={hintId}
        className="cc-toggle"
        disabled={disabled}
        onClick={toggle}
      />
    </div>
  );
}

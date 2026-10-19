import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { Button } from "./Button";
import { Field, TextInput } from "./Field";

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  pressed?: boolean;
  children: ReactNode;
}

/** Toggle chip (button with aria-pressed); shows a check mark when pressed. */
export function Chip({ pressed, className, children, type = "button", ...rest }: ChipProps) {
  return (
    <button type={type} className={cn("ap-chip", className)} aria-pressed={pressed} {...rest}>
      {pressed && <Icon glyph="check" size={16} />}
      {children}
    </button>
  );
}

export interface ChipOption {
  id: string;
  label: string;
}

interface ChipSelectProps {
  label: ReactNode;
  options: ChipOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  hint?: ReactNode;
  /** Enables inline creation; must return the id of the created option. */
  onCreate?: (name: string) => Promise<string> | string;
  createLabel?: string;
  className?: string;
}

/** Multi-select as a group of toggle chips, optionally with "create and assign". */
export function ChipSelect({
  label,
  options,
  selected,
  onChange,
  hint,
  onCreate,
  createLabel,
  className,
}: ChipSelectProps) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  async function add() {
    const name = draft.trim();
    if (!name || !onCreate) return;
    setBusy(true);
    try {
      const id = await onCreate(name);
      onChange([...selected, id]);
      setCreating(false);
      setDraft("");
    } catch {
      // The caller reports the failure (e.g. a toast); the row stays open for another try.
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className={cn("ap-fieldset", className)}>
      <legend>{label}</legend>
      <div className="ap-chips">
        {options.map((o) => (
          <Chip key={o.id} pressed={selected.includes(o.id)} onClick={() => toggle(o.id)}>
            {o.label}
          </Chip>
        ))}
        {onCreate && !creating && (
          <button
            type="button"
            className="ap-chip ap-chip--add"
            onClick={() => {
              setCreating(true);
              setDraft("");
            }}
          >
            <Icon glyph="plus" size={16} />
            {createLabel ?? t("ui.chipSelect.create")}
          </button>
        )}
      </div>
      {creating && (
        <div className="ap-row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field label={t("common.name")}>
              <TextInput
                value={draft}
                autoFocus
                name="new-chip-name"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("ui.chipSelect.placeholder")}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void add();
                  } else if (e.key === "Escape") {
                    // Close the create row without closing a surrounding dialog.
                    e.preventDefault();
                    e.stopPropagation();
                    setCreating(false);
                  }
                }}
              />
            </Field>
          </div>
          <Button onClick={add} loading={busy} disabled={!draft.trim()}>
            {t("ui.chipSelect.createAndAssign")}
          </Button>
          <Button variant="ghost" onClick={() => setCreating(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      )}
      {hint && <span className="cc-hint">{hint}</span>}
    </fieldset>
  );
}

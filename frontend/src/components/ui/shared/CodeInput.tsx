import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface CodeInputProps {
  /** Entered digits; a gap (field left empty in the middle) is a space. */
  value: string;
  onChange: (value: string) => void;
  /** Called with the full code as soon as every field holds a digit. */
  onComplete?: (code: string) => void;
  /** Number of digits, shown in groups of three separated by a dash. */
  length?: number;
  /** Accessible name of the group. */
  label: string;
  /** Id of the first field (jump target of an ErrorSummary). */
  id?: string;
  invalid?: boolean;
  /** Id of the element with the error / hint text. */
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}

const GROUP = 3;

/**
 * One-time code entry: one single-character field per digit (`[ ][ ][ ] - [ ][ ][ ]`), digits only,
 * auto-advance, backspace goes back, arrows move, paste (also with spaces / dash) and the browser's
 * `one-time-code` autofill fill all fields. Controlled; `onComplete` fires once the last digit is in.
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  length = 6,
  label,
  id,
  invalid,
  describedBy,
  disabled,
  className,
}: CodeInputProps) {
  const { t } = useTranslation();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length }, (_, i) => {
    const c = value[i];
    return c && /\d/.test(c) ? c : "";
  });

  function focusAt(i: number) {
    const el = refs.current[Math.max(0, Math.min(length - 1, i))];
    el?.focus();
    el?.select();
  }

  function commit(next: string[], focusIndex: number) {
    const joined = next
      .map((c) => c || " ")
      .join("")
      .trimEnd();
    onChange(joined);
    if (next.every(Boolean)) {
      onComplete?.(joined);
      focusAt(length - 1);
    } else {
      focusAt(focusIndex);
    }
  }

  /** Writes `digits` from field `from` on; returns the next field to focus. */
  function fill(from: number, digits: string): string[] {
    const next = [...chars];
    for (let k = 0; k < digits.length && from + k < length; k++) next[from + k] = digits[k];
    return next;
  }

  function handleChange(i: number, raw: string) {
    let digits = raw.replace(/\D/g, "");
    if (digits.length === 2 && chars[i]) {
      // typed over a filled field: keep the new digit
      digits = digits[0] === chars[i] ? digits[1] : digits[0];
    }
    if (!digits) {
      const next = [...chars];
      next[i] = "";
      commit(next, i);
      return;
    }
    const next = fill(i, digits);
    commit(next, Math.min(length - 1, i + digits.length));
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !chars[i] && i > 0) {
      e.preventDefault();
      const next = [...chars];
      next[i - 1] = "";
      commit(next, i - 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusAt(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusAt(i + 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusAt(length - 1);
    }
  }

  function handlePaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    const digits = e.clipboardData.getData("text").replace(/\D/g, "");
    e.preventDefault();
    if (!digits) return;
    // a full code always replaces everything, a partial one goes in from the current field
    const start = digits.length >= length ? 0 : i;
    commit(fill(start, digits.slice(0, length)), Math.min(length - 1, start + digits.length));
  }

  const fields = [];
  for (let i = 0; i < length; i++) {
    if (i > 0 && i % GROUP === 0) {
      fields.push(
        <span key={`sep${i}`} aria-hidden="true" className="t-h2 t-muted select-none">
          -
        </span>,
      );
    }
    fields.push(
      <input
        key={i}
        ref={(el) => {
          refs.current[i] = el;
        }}
        id={i === 0 ? id : undefined}
        className={cn("cc-input t-h2 w-11 px-0 text-center tabular-nums")}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete={i === 0 ? "one-time-code" : "off"}
        aria-label={t("ui.codeInput.digit", { index: i + 1, total: length })}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        value={chars[i]}
        onChange={(e) => handleChange(i, e.target.value)}
        onKeyDown={(e) => handleKeyDown(i, e)}
        onPaste={(e) => handlePaste(i, e)}
        onFocus={(e) => e.target.select()}
      />,
    );
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex items-center justify-center gap-2", className)}
    >
      {fields}
    </div>
  );
}

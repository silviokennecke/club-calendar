import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon";
import { IconButton } from "./Button";
import { buttonClass } from "./buttonClass";

interface CopyFieldProps {
  label: string;
  value: string;
  hint?: ReactNode;
  /** Mask the value until the user reveals it. */
  secret?: boolean;
  /** Optional "open" link next to the copy button. */
  openHref?: string;
  openLabel?: string;
  id?: string;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/** Read-only value with copy button, feedback ("Kopiert") and screen-reader announcement. */
export function CopyField({ label, value, hint, secret, openHref, openLabel, id }: CopyFieldProps) {
  const { t } = useTranslation();
  const uid = useId().replace(/:/g, "");
  const inputId = id ?? `copy-${uid}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const [revealed, setRevealed] = useState(false);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const shown = secret && !revealed ? "•".repeat(Math.max(value.length, 8)) : value;

  async function copy() {
    const ok = await writeClipboard(value);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <div className="ap-stack ap-stack--sm">
      <label className="cc-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="ap-row" style={{ gap: 8, alignItems: "stretch" }}>
        <input
          id={inputId}
          className="cc-input ap-code"
          translate="no"
          type="text"
          readOnly
          name="copy-value"
          autoComplete="off"
          spellCheck={false}
          value={shown}
          aria-describedby={hintId}
          style={{ flex: "1 1 240px", minWidth: 0 }}
          onFocus={(e) => (!secret || revealed) && e.currentTarget.select()}
        />
        {secret && (
          <IconButton
            variant="outline"
            icon={revealed ? "eye-off" : "eye"}
            label={revealed ? t("ui.copyField.hideSecret") : t("ui.copyField.showSecret")}
            aria-pressed={revealed}
            onClick={() => setRevealed((r) => !r)}
          />
        )}
        <button type="button" className={buttonClass("secondary")} onClick={copy}>
          <Icon glyph={state === "copied" ? "check" : "copy"} size={18} />
          {state === "copied" ? t("ui.copyField.copied") : t("ui.copyField.copy")}
        </button>
        {openHref && openLabel && (
          <a className={buttonClass("secondary")} href={openHref} target="_blank" rel="noreferrer">
            <Icon glyph="external" size={18} />
            {openLabel}
          </a>
        )}
      </div>
      {hint && (
        <span id={hintId} className="cc-hint">
          {hint}
        </span>
      )}
      {state === "failed" && (
        <span className="cc-hint cc-hint--error">{t("ui.copyField.failed")}</span>
      )}
      <span className="ap-sr" role="status">
        {state === "copied" ? t("ui.copyField.announce", { label }) : ""}
      </span>
    </div>
  );
}

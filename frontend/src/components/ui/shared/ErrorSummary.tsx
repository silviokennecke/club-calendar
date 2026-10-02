import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

export interface ErrorSummaryItem {
  /** Id of the invalid control; the link moves focus there. */
  fieldId: string;
  message: ReactNode;
}

interface ErrorSummaryProps {
  title: ReactNode;
  errors: ErrorSummaryItem[];
  /**
   * Increment to move focus to the summary (e.g. after a failed submit). 0 = never focus,
   * so live updates while typing do not steal focus.
   */
  focusSignal?: number;
  className?: string;
}

/**
 * Error summary above a form (design: danger Banner "… ist noch nicht vollständig."): lists all
 * problems as links to their fields and takes focus after a failed submit, so screen reader and
 * keyboard users learn what to fix and can jump there.
 */
export function ErrorSummary({ title, errors, focusSignal = 0, className }: ErrorSummaryProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = `errsum-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    if (focusSignal > 0) ref.current?.focus();
  }, [focusSignal]);

  if (errors.length === 0) return null;

  function jump(fieldId: string) {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.focus();
    el.scrollIntoView?.({ block: "center" });
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      aria-labelledby={titleId}
      className={cn("ap-banner ap-banner--danger ap-errorsummary", className)}
    >
      <span className="ap-banner-icon">
        <Icon glyph="x-circle" size={22} />
      </span>
      <div className="ap-grow">
        <p className="t-label" id={titleId}>
          {title}
        </p>
        <p className="ap-sr">{t("ui.errorSummary.intro")}</p>
        <ul className="t-sm">
          {errors.map((e) => (
            <li key={e.fieldId + String(e.message)}>
              <a
                href={`#${e.fieldId}`}
                onClick={(ev) => {
                  ev.preventDefault();
                  jump(e.fieldId);
                }}
              >
                {e.message}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

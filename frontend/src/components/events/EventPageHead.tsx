import { useEffect, useRef, type ReactNode } from "react";
import { IconButton } from "@/components/ui/shared";

interface EventPageHeadProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Below the subtitle (e.g. a StatusBadge). */
  extra?: ReactNode;
  /** Close button (design: x in the dialog head) with a label naming the consequence. */
  closeLabel?: string;
  onClose?: () => void;
  titleId?: string;
}

/**
 * Head of the routed event pages (design: ap-dialog-head of EventNew / EventForm / EventSeries).
 * The heading receives focus when the page opens, like a dialog would.
 */
export function EventPageHead({
  title,
  subtitle,
  extra,
  closeLabel,
  onClose,
  titleId,
}: EventPageHeadProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <header className="ap-pagedialog-head">
      <div>
        <h1 ref={ref} id={titleId} tabIndex={-1} className="t-h1 ap-focus-target">
          {title}
        </h1>
        {subtitle && <p className="t-body">{subtitle}</p>}
        {extra && <div style={{ marginTop: "var(--space-2)" }}>{extra}</div>}
      </div>
      {onClose && closeLabel && (
        <IconButton icon="x" variant="outline" label={closeLabel} onClick={onClose} />
      )}
    </header>
  );
}

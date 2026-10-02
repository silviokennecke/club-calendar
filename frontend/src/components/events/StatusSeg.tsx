import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/shared";
import type { EventStatus } from "@/lib/events";

interface StatusSegProps {
  value: EventStatus;
  onChange: (value: EventStatus) => void;
  /** Accessible name of the group (default "Status des Termins"). */
  label?: string;
  hintId?: string;
}

/** Draft / published switch as two toggle buttons (design: ap-seg with aria-pressed). */
export function StatusSeg({ value, onChange, label, hintId }: StatusSegProps) {
  const { t } = useTranslation();
  return (
    <div
      className="ap-seg"
      role="group"
      aria-label={label ?? t("events.form.status.label")}
      aria-describedby={hintId}
      style={{ alignSelf: "flex-start", flexWrap: "wrap" }}
    >
      <button type="button" aria-pressed={value === "draft"} onClick={() => onChange("draft")}>
        <Icon glyph="edit" size={16} />
        {t("events.form.status.draft")}
      </button>
      <button
        type="button"
        aria-pressed={value === "published"}
        onClick={() => onChange("published")}
      >
        <Icon glyph="check" size={16} />
        {t("events.form.status.published")}
      </button>
    </div>
  );
}

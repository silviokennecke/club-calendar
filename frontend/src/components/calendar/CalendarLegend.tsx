import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/shared";

interface Props {
  showHoliday?: boolean;
  /** Adds the drag hint (only where events can be moved). */
  showDragHint?: boolean;
  /** The draft entry; the public view never shows drafts. */
  showDraft?: boolean;
  /** Adds the notice entry (only when the view contains notices). */
  showNotice?: boolean;
}

/** Explains the chip styles (design: ap-legend). */
export function CalendarLegend({
  showHoliday = true,
  showDragHint,
  showDraft = true,
  showNotice,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="ap-legend">
      <span>
        <i className="ap-sw ap-sw--published" aria-hidden="true" />
        {t("calendar.legend.published")}
      </span>
      {showDraft && (
        <span>
          <i className="ap-sw ap-sw--draft" aria-hidden="true" />
          {t("calendar.legend.draft")}
        </span>
      )}
      {showNotice && (
        <span>
          <i className="ap-sw ap-sw--notice" aria-hidden="true" />
          {t("calendar.legend.notice")}
        </span>
      )}
      {showHoliday && (
        <span>
          <i className="ap-sw ap-sw--holiday" aria-hidden="true" />
          {t("calendar.legend.holiday")}
        </span>
      )}
      {showDragHint && (
        <span>
          <Icon glyph="move" size={16} />
          {t("calendar.legend.drag")}
        </span>
      )}
    </div>
  );
}
